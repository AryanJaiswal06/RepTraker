# pyright: reportCallIssue=false
# (Flask-SQLAlchemy's type stubs hide the keyword constructor of db.Model; this is a typing limitation only.)
import json
import logging
import math
import os
import re
import secrets
import smtplib
import sqlite3
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from functools import wraps
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, abort, g, jsonify, redirect, request, send_from_directory, session
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import ForeignKey, String, Text, event, func, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, joinedload, mapped_column, relationship, selectinload
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env", override=False)
DIST_DIR = Path(os.environ.get("REPTRACK_STATIC_DIR") or (BASE_DIR.parent / "frontend" / "dist"))


def normalize_database_uri(raw: str) -> str:
    """Normalize hosted PostgreSQL URLs (postgres:// / postgresql://) to use psycopg v3."""
    uri = raw.strip()
    if uri.startswith("postgres://"):
        return "postgresql+psycopg://" + uri[len("postgres://") :]
    if uri.startswith("postgresql://"):
        return "postgresql+psycopg://" + uri[len("postgresql://") :]
    return uri


db_uri = normalize_database_uri(
    os.environ.get("REPTRACK_DATABASE_URI") or os.environ.get("DATABASE_URL") or "sqlite:///reptrack.db"
)

app = Flask(__name__, static_folder=None)
app.config["SQLALCHEMY_DATABASE_URI"] = db_uri
if not db_uri.startswith("sqlite:"):
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        "pool_pre_ping": True,
        "pool_recycle": 300,
    }
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024  # 5 MB payload cap
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("REPTRACK_COOKIE_SECURE", "").lower() in ("1", "true", "yes")
app.json.sort_keys = False


def load_secret_key() -> str:
    env_key = os.environ.get("REPTRACK_SECRET_KEY")
    if env_key:
        return env_key
    key_file = Path(app.instance_path) / ".secret_key"
    key_file.parent.mkdir(parents=True, exist_ok=True)
    if key_file.is_file():
        return key_file.read_text(encoding="utf-8").strip()
    generated = secrets.token_hex(32)
    key_file.write_text(generated, encoding="utf-8")
    return generated


app.config["SECRET_KEY"] = load_secret_key()

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


class Base(DeclarativeBase):
    pass


db = SQLAlchemy(app, model_class=Base)

MAX_SESSIONS = 15  # retained workout sessions per exercise
MAX_SETS_PER_SESSION = 50
MAX_WEIGHT = 2000.0
MAX_REPS = 1000
OTP_TTL_MINUTES = 10
OTP_COOLDOWN_SECONDS = 30
OTP_MAX_ATTEMPTS = 5
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@event.listens_for(Engine, "connect")
def _set_sqlite_pragma(dbapi_connection, _connection_record):
    if isinstance(dbapi_connection, sqlite3.Connection):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


def utcnow_naive() -> datetime:
    """Return current UTC time as a naive datetime for SQLite compatibility."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


group_exercises = db.Table(
    "group_exercises",
    db.Column("group_id", db.Integer, db.ForeignKey("workout_group.id", ondelete="CASCADE"), primary_key=True),
    db.Column("exercise_id", db.Integer, db.ForeignKey("exercise.id", ondelete="CASCADE"), primary_key=True),
)


class User(db.Model):
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str] = mapped_column(String(256), default="")
    google_sub: Mapped[str | None] = mapped_column(String(128), unique=True, index=True, nullable=True)
    auth_provider: Mapped[str] = mapped_column(String(20), default="password")
    email_verified: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(default=utcnow_naive)

    def to_dict(self):
        return dict(
            id=self.id,
            email=self.email,
            name=self.name,
            has_password=bool(self.password_hash),
            auth_provider=self.auth_provider,
            email_verified=bool(self.email_verified),
        )


class EmailOTP(db.Model):
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), index=True)
    code_hash: Mapped[str] = mapped_column(String(256))
    attempts: Mapped[int] = mapped_column(default=0)
    expires_at: Mapped[datetime] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(default=utcnow_naive)


class Group(db.Model):
    __tablename__ = "workout_group"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(80))
    exercises: Mapped[list["Exercise"]] = relationship(secondary=group_exercises, back_populates="groups")

    def to_dict(self):
        return dict(id=self.id, name=self.name, exercise_ids=[e.id for e in self.exercises])


class Exercise(db.Model):
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(120))
    muscle_group: Mapped[str] = mapped_column(String(40), default="Other")
    equipment: Mapped[str] = mapped_column(String(40), default="Machine")
    notes: Mapped[str] = mapped_column(String(500), default="")
    archived: Mapped[bool] = mapped_column(default=False)
    sessions: Mapped[list["WorkoutSession"]] = relationship(
        back_populates="exercise",
        cascade="all, delete-orphan",
        order_by="[WorkoutSession.performed_at.desc(), WorkoutSession.id.desc()]",
    )
    groups: Mapped[list[Group]] = relationship(secondary=group_exercises, back_populates="exercises")

    def to_dict(self):
        return dict(
            id=self.id,
            name=self.name,
            muscle_group=self.muscle_group,
            equipment=self.equipment,
            notes=self.notes,
            archived=self.archived,
            group_ids=[g.id for g in self.groups],
        )


class WorkoutSession(db.Model):
    id: Mapped[int] = mapped_column(primary_key=True)
    exercise_id: Mapped[int] = mapped_column(ForeignKey("exercise.id", ondelete="CASCADE"), index=True)
    performed_at: Mapped[datetime] = mapped_column(default=utcnow_naive)
    sets_json: Mapped[str] = mapped_column(Text, default="[]")  # [{weight (kg), reps, done}]
    exercise: Mapped[Exercise] = relationship(back_populates="sessions")

    @property
    def sets(self):
        return json.loads(self.sets_json or "[]")

    def to_dict(self):
        return dict(
            id=self.id,
            exercise_id=self.exercise_id,
            exercise_name=self.exercise.name,
            performed_at=self.performed_at.isoformat() + "Z",
            sets=self.sets,
        )


@app.before_request
def load_current_user():
    uid = session.get("user_id")
    g.user = db.session.get(User, uid) if isinstance(uid, int) else None


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if g.user is None:
            return jsonify(error="Authentication required"), 401
        return fn(*args, **kwargs)

    return wrapper


@app.after_request
def add_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    elif request.path.startswith("/assets/"):
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


@app.errorhandler(HTTPException)
def handle_http_error(err: HTTPException):
    return jsonify(error=err.description or err.name), err.code


@app.errorhandler(ValueError)
def handle_value_error(err: ValueError):
    return jsonify(error=str(err) or "Invalid request data"), 400


@app.errorhandler(Exception)
def handle_unexpected_error(err: Exception):
    app.logger.exception("Unhandled error on %s %s: %s", request.method, request.path, err)
    return jsonify(error="Internal server error"), 500


def json_dict() -> dict:
    """Parse request JSON as a dictionary, returning 400 on malformed or non-object payloads."""
    d = request.get_json(silent=False)
    if d is None:
        return {}
    if not isinstance(d, dict):
        raise ValueError("JSON body must be an object")
    return d


def clean_str(val, default: str = "", field: str = "value", max_len: int | None = None) -> str:
    if val is None:
        return default
    if not isinstance(val, str):
        raise ValueError(f"{field} must be a string")
    cleaned = val.strip()
    if max_len is not None and len(cleaned) > max_len:
        raise ValueError(f"{field} must be at most {max_len} characters")
    return cleaned


def clean_email(val) -> str:
    email = clean_str(val, "", "email", max_len=254).lower()
    if not email or not EMAIL_RE.match(email):
        raise ValueError("Please enter a valid email address")
    return email


def parse_int(val, field: str = "id") -> int:
    if isinstance(val, bool) or not isinstance(val, (int, str)):
        raise ValueError(f"Invalid {field}")
    if isinstance(val, str):
        val = val.strip()
    return int(val)


def parse_int_list(raw, field: str = "ids") -> list[int]:
    if not isinstance(raw, list):
        raise ValueError(f"{field} must be a list")
    return [parse_int(x, field) for x in raw]


def clean_sets(raw):
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("sets must be a list")
    if len(raw) > MAX_SETS_PER_SESSION:
        raise ValueError(f"At most {MAX_SETS_PER_SESSION} sets per session are allowed")
    out = []
    for s in raw:
        if not isinstance(s, dict):
            raise ValueError("Each set must be an object")
        w_raw = s.get("weight")
        r_raw = s.get("reps")
        if isinstance(w_raw, bool) or isinstance(r_raw, bool):
            raise ValueError("Set weight and reps must be numbers")
        weight = float(0 if w_raw is None or w_raw == "" else w_raw)
        reps = int(float(0 if r_raw is None or r_raw == "" else r_raw))
        if not math.isfinite(weight) or weight > MAX_WEIGHT:
            raise ValueError(f"Set weight must be between 0 and {int(MAX_WEIGHT)} kg")
        if reps > MAX_REPS:
            raise ValueError(f"Set reps must be between 0 and {MAX_REPS}")
        out.append({"weight": max(weight, 0.0), "reps": max(reps, 0), "done": bool(s.get("done", True))})
    return out


def parse_date(v) -> datetime:
    if not v:
        return utcnow_naive()
    if not isinstance(v, str):
        raise ValueError("performed_at must be an ISO timestamp string")
    dt = datetime.fromisoformat(v.strip().replace("Z", "+00:00"))
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def trim_history(exercise_id: int):
    """Keep only the newest MAX_SESSIONS sessions of ONE exercise."""
    old = (
        WorkoutSession.query.filter_by(exercise_id=exercise_id)
        .order_by(WorkoutSession.performed_at.desc(), WorkoutSession.id.desc())
        .offset(MAX_SESSIONS)
        .all()
    )
    for s in old:
        db.session.delete(s)


def stats(ex: Exercise):
    ss = [s for s in ex.sessions if s.sets]
    if not ss:
        return dict(last_weight=None, last_reps=None, max_weight=None, total_sessions=len(ex.sessions), last_date=None)
    last_sets = [x for x in ss[0].sets if x.get("done")] or ss[0].sets
    weights = [x["weight"] for s in ss for x in ([x for x in s.sets if x.get("done")] or s.sets)]
    return dict(
        last_weight=last_sets[-1]["weight"] if last_sets else None,
        last_reps=last_sets[-1]["reps"] if last_sets else None,
        max_weight=max(weights) if weights else None,
        total_sessions=len(ex.sessions),
        last_date=ss[0].performed_at.isoformat() + "Z",
    )


def session_progress(ex: Exercise):
    """Return chronological progress points (best weight, volume, est 1RM) for charting."""
    out = []
    for s in reversed(ex.sessions):
        sets = [x for x in s.sets if x.get("done")] or s.sets
        if not sets:
            continue
        best_weight = max((x["weight"] for x in sets), default=0.0)
        volume = sum(x["weight"] * x["reps"] for x in sets)
        est_1rm = max((x["weight"] * (1.0 + x["reps"] / 30.0) for x in sets if x["weight"] > 0), default=0.0)
        out.append(
            dict(
                date=s.performed_at.isoformat() + "Z",
                best_weight=round(best_weight, 2),
                volume=round(volume, 2),
                est_1rm=round(est_1rm, 2),
            )
        )
    return out


SEED = [
    ("Bench Press", "Chest", "Barbell"),
    ("Incline Dumbbell Press", "Chest", "Dumbbell"),
    ("Lat Pulldown", "Back", "Cable"),
    ("Barbell Row", "Back", "Barbell"),
    ("Overhead Press", "Shoulders", "Barbell"),
    ("Barbell Squat", "Legs", "Barbell"),
    ("Leg Press", "Legs", "Machine"),
    ("Pull-up", "Back", "Bodyweight"),
]


def seed_user_defaults(user_id: int):
    by_name = {}
    for n, m, eq in SEED:
        by_name[n] = Exercise(user_id=user_id, name=n, muscle_group=m, equipment=eq)
        db.session.add(by_name[n])
    for gname, names in {
        "Push": ["Bench Press", "Incline Dumbbell Press", "Overhead Press"],
        "Pull": ["Lat Pulldown", "Barbell Row", "Pull-up"],
        "Legs": ["Barbell Squat", "Leg Press"],
    }.items():
        db.session.add(Group(user_id=user_id, name=gname, exercises=[by_name[n] for n in names]))


def provision_new_user_data(user: User):
    """Assign legacy unowned records to the first user, or seed starter exercises."""
    legacy_ex = Exercise.query.filter(Exercise.user_id.is_(None)).all()
    legacy_grp = Group.query.filter(Group.user_id.is_(None)).all()
    if legacy_ex or legacy_grp:
        for e in legacy_ex:
            e.user_id = user.id
        for gr in legacy_grp:
            gr.user_id = user.id
    elif os.environ.get("REPTRACK_SEED", "1") != "0":
        seed_user_defaults(user.id)


def start_user_session(user: User):
    session.clear()
    session["user_id"] = user.id
    session.permanent = True


def smtp_configured() -> bool:
    return bool(os.environ.get("SMTP_HOST"))


def google_configured() -> bool:
    return bool(os.environ.get("GOOGLE_CLIENT_ID") and os.environ.get("GOOGLE_CLIENT_SECRET"))


def send_otp_email(to_email: str, code: str) -> str:
    """Send 6-digit OTP via SMTP, or log locally in dev when SMTP_HOST is unset."""
    host = os.environ.get("SMTP_HOST", "").strip()
    if not host:
        bind_host = os.environ.get("REPTRACK_HOST", "127.0.0.1")
        allow_dev = os.environ.get("REPTRACK_ALLOW_DEV_OTP", "1") != "0" and bind_host in ("127.0.0.1", "localhost")
        if not allow_dev:
            raise RuntimeError("Email delivery is not configured on this server")
        app.logger.info("Local dev OTP for %s: %s", to_email, code)
        return "local"

    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ.get("SMTP_USER", "")
    password = os.environ.get("SMTP_PASS", "")
    sender = os.environ.get("SMTP_FROM") or user or "noreply@reptrack.app"
    use_ssl = os.environ.get("SMTP_SSL", "").lower() in ("1", "true", "yes") or port == 465
    use_tls = os.environ.get("SMTP_TLS", "1").lower() in ("1", "true", "yes") and not use_ssl

    msg = EmailMessage()
    msg["Subject"] = f"Your RepTrack verification code: {code}"
    msg["From"] = sender
    msg["To"] = to_email
    msg.set_content(
        f"Your RepTrack sign-in code is: {code}\n\n"
        f"This code expires in {OTP_TTL_MINUTES} minutes. If you didn't request it, you can ignore this email."
    )

    if use_ssl:
        with smtplib.SMTP_SSL(host, port, timeout=10) as smtp:
            if user and password:
                smtp.login(user, password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=10) as smtp:
            if use_tls:
                smtp.starttls()
            if user and password:
                smtp.login(user, password)
            smtp.send_message(msg)
    return "smtp"


def google_callback_url() -> str:
    explicit = os.environ.get("GOOGLE_REDIRECT_URI", "").strip()
    if explicit:
        return explicit
    return f"{request.url_root.rstrip('/')}/api/auth/google/callback"


def exchange_google_code(code: str, redirect_uri: str) -> dict:
    """Exchange Google OAuth authorization code and fetch verified userinfo."""
    token_body = urllib.parse.urlencode(
        {
            "code": code,
            "client_id": os.environ["GOOGLE_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
    ).encode("utf-8")
    token_req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=token_body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(token_req, timeout=10) as resp:
        tokens = json.loads(resp.read().decode("utf-8"))

    access_token = tokens.get("access_token")
    if not access_token:
        raise ValueError("Google token exchange failed")

    info_req = urllib.request.Request(
        "https://openidconnect.googleapis.com/v1/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    with urllib.request.urlopen(info_req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ---------- health ----------
@app.get("/api/health")
def health():
    try:
        db.session.execute(text("SELECT 1"))
        return jsonify(status="ok"), 200
    except Exception:
        app.logger.exception("Health check failed")
        return jsonify(status="error"), 503


# ---------- auth ----------
@app.get("/api/auth/providers")
def auth_providers():
    return jsonify(google_enabled=google_configured(), smtp_enabled=smtp_configured())


@app.get("/api/auth/me")
def auth_me():
    return jsonify(user=g.user.to_dict() if g.user else None)


@app.post("/api/auth/register/start")
def register_start():
    d = json_dict()
    name = clean_str(d.get("name"), "", "name", max_len=80)
    if not name:
        return jsonify(error="Name is required"), 400
    email = clean_email(d.get("email"))
    password = d.get("password")
    if not isinstance(password, str) or len(password) < 8 or len(password) > 128:
        return jsonify(error="Password must be between 8 and 128 characters"), 400
    if User.query.filter_by(email=email).first():
        return jsonify(error="An account with that email already exists"), 409

    now = utcnow_naive()
    latest = EmailOTP.query.filter_by(email=email).order_by(EmailOTP.created_at.desc()).first()
    if latest and (now - latest.created_at).total_seconds() < OTP_COOLDOWN_SECONDS:
        wait = int(OTP_COOLDOWN_SECONDS - (now - latest.created_at).total_seconds()) + 1
        return jsonify(error=f"Please wait {wait}s before requesting another code"), 429

    code = f"{secrets.randbelow(1_000_000):06d}"
    EmailOTP.query.filter_by(email=email).delete()
    otp = EmailOTP(
        email=email,
        code_hash=generate_password_hash(code),
        expires_at=now + timedelta(minutes=OTP_TTL_MINUTES),
    )
    db.session.add(otp)
    try:
        delivery = send_otp_email(email, code)
    except RuntimeError as ex:
        db.session.rollback()
        return jsonify(error=str(ex)), 503
    except smtplib.SMTPException as ex:
        db.session.rollback()
        app.logger.exception("SMTP delivery failed: %s", ex)
        return jsonify(error="Failed to send verification email"), 502

    db.session.commit()
    payload = {"ok": True, "delivery": delivery, "expires_in": OTP_TTL_MINUTES * 60}
    if delivery == "local":
        payload["dev_otp"] = code
    return jsonify(payload)


@app.post("/api/auth/register/verify")
def register_verify():
    d = json_dict()
    name = clean_str(d.get("name"), "", "name", max_len=80)
    if not name:
        return jsonify(error="Name is required"), 400
    email = clean_email(d.get("email"))
    password = d.get("password")
    if not isinstance(password, str) or len(password) < 8 or len(password) > 128:
        return jsonify(error="Password must be between 8 and 128 characters"), 400
    code = clean_str(d.get("code"), "", "code", max_len=12)
    if not re.fullmatch(r"\d{6}", code):
        return jsonify(error="Enter the 6-digit verification code"), 400

    if User.query.filter_by(email=email).first():
        return jsonify(error="An account with that email already exists"), 409

    otp = EmailOTP.query.filter_by(email=email).order_by(EmailOTP.created_at.desc()).first()
    now = utcnow_naive()
    if not otp or now > otp.expires_at:
        return jsonify(error="Verification code expired or not found. Request a new code."), 401
    if otp.attempts >= OTP_MAX_ATTEMPTS:
        return jsonify(error="Too many invalid attempts. Request a new verification code."), 429

    if not check_password_hash(otp.code_hash, code):
        otp.attempts += 1
        db.session.commit()
        return jsonify(error="Invalid verification code"), 401

    EmailOTP.query.filter_by(email=email).delete()
    user = User(
        email=email,
        name=name,
        password_hash=generate_password_hash(password),
        auth_provider="password",
        email_verified=True,
    )
    db.session.add(user)
    db.session.flush()
    provision_new_user_data(user)
    db.session.commit()
    start_user_session(user)
    return jsonify(user=user.to_dict()), 201


@app.post("/api/auth/login")
def login():
    d = json_dict()
    email = clean_email(d.get("email"))
    password = d.get("password")
    if not isinstance(password, str) or not password:
        return jsonify(error="Email and password are required"), 400
    user = User.query.filter_by(email=email).first()
    if not user or not user.password_hash or not check_password_hash(user.password_hash, password):
        return jsonify(error="Invalid email or password"), 401
    start_user_session(user)
    return jsonify(user=user.to_dict())


@app.get("/api/auth/google/start")
def google_start():
    if not google_configured():
        return redirect("/?auth_error=" + urllib.parse.quote("Google Sign-In is not configured on this server."))
    state = secrets.token_urlsafe(24)
    session["oauth_state"] = state
    params = urllib.parse.urlencode(
        {
            "client_id": os.environ["GOOGLE_CLIENT_ID"],
            "redirect_uri": google_callback_url(),
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "prompt": "select_account",
        }
    )
    return redirect(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")


@app.get("/api/auth/google/callback")
def google_callback():
    if not google_configured():
        return redirect("/?auth_error=" + urllib.parse.quote("Google Sign-In is not configured on this server."))
    if request.args.get("error"):
        return redirect("/?auth_error=" + urllib.parse.quote("Google sign-in was cancelled or denied."))

    expected_state = session.pop("oauth_state", None)
    got_state = request.args.get("state")
    code = request.args.get("code")
    if not expected_state or not got_state or not secrets.compare_digest(expected_state, got_state) or not code:
        return redirect("/?auth_error=" + urllib.parse.quote("Invalid Google sign-in session. Please try again."))

    try:
        info = exchange_google_code(code, google_callback_url())
    except (urllib.error.URLError, ValueError, KeyError, json.JSONDecodeError) as ex:
        app.logger.warning("Google OAuth failed: %s", ex)
        return redirect("/?auth_error=" + urllib.parse.quote("Could not complete Google sign-in. Please try again."))

    sub = clean_str(info.get("sub"), "", "sub", max_len=128)
    email = clean_str(info.get("email"), "", "email", max_len=254).lower()
    if not sub or not email or not EMAIL_RE.match(email) or not info.get("email_verified"):
        return redirect("/?auth_error=" + urllib.parse.quote("Google account must have a verified email address."))

    name = clean_str(info.get("name"), "", "name", max_len=80) or email.split("@", 1)[0][:80]
    user = User.query.filter_by(google_sub=sub).first() or User.query.filter_by(email=email).first()
    if not user:
        user = User(
            email=email,
            name=name,
            password_hash="",
            google_sub=sub,
            auth_provider="google",
            email_verified=True,
        )
        db.session.add(user)
        db.session.flush()
        provision_new_user_data(user)
    else:
        user.google_sub = sub
        user.email_verified = True
    db.session.commit()
    start_user_session(user)
    return redirect("/")


@app.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.put("/api/auth/password")
@login_required
def change_password():
    d = json_dict()
    new_pw = d.get("new_password")
    if g.user.password_hash:
        current = d.get("current_password")
        if not isinstance(current, str) or not check_password_hash(g.user.password_hash, current):
            return jsonify(error="Current password is incorrect"), 400
    if not isinstance(new_pw, str) or len(new_pw) < 8 or len(new_pw) > 128:
        return jsonify(error="New password must be between 8 and 128 characters"), 400
    g.user.password_hash = generate_password_hash(new_pw)
    db.session.commit()
    return jsonify(user=g.user.to_dict())


# ---------- exercises ----------
def get_user_exercise_or_404(eid: int) -> Exercise:
    ex = Exercise.query.filter_by(id=eid, user_id=g.user.id).first()
    if not ex:
        abort(404)
    return ex


def get_user_group_or_404(gid: int) -> Group:
    grp = Group.query.filter_by(id=gid, user_id=g.user.id).first()
    if not grp:
        abort(404)
    return grp


@app.get("/api/exercises")
@login_required
def list_exercises():
    q = (request.args.get("q") or "").strip().lower()
    archived = request.args.get("archived") == "1"
    query = (
        Exercise.query.filter_by(user_id=g.user.id)
        .options(selectinload(Exercise.groups))
        .order_by(Exercise.muscle_group, Exercise.name)
    )
    if not archived:
        query = query.filter_by(archived=False)
    items = query.all()
    if q:
        items = [
            e
            for e in items
            if q in e.name.lower()
            or q in (e.muscle_group or "").lower()
            or q in (e.equipment or "").lower()
        ]
    return jsonify([e.to_dict() for e in items])


@app.post("/api/exercises")
@login_required
def create_exercise():
    d = json_dict()
    name = clean_str(d.get("name"), "", "name", max_len=120)
    if not name:
        return jsonify(error="Name is required"), 400
    e = Exercise(
        user_id=g.user.id,
        name=name,
        muscle_group=clean_str(d.get("muscle_group"), "Other", "muscle_group", max_len=40) or "Other",
        equipment=clean_str(d.get("equipment"), "Machine", "equipment", max_len=40) or "Machine",
        notes=clean_str(d.get("notes"), "", "notes", max_len=500),
    )
    if "group_ids" in d:
        ids = parse_int_list(d["group_ids"], "group_ids")
        e.groups = Group.query.filter(Group.user_id == g.user.id, Group.id.in_(ids)).all() if ids else []
    db.session.add(e)
    db.session.commit()
    return jsonify(e.to_dict()), 201


@app.put("/api/exercises/<int:eid>")
@login_required
def update_exercise(eid: int):
    e = get_user_exercise_or_404(eid)
    d = json_dict()
    if "name" in d:
        e.name = clean_str(d["name"], "", "name", max_len=120)
        if not e.name:
            return jsonify(error="Name is required"), 400
    if "muscle_group" in d:
        e.muscle_group = clean_str(d["muscle_group"], "Other", "muscle_group", max_len=40) or "Other"
    if "equipment" in d:
        e.equipment = clean_str(d["equipment"], "Machine", "equipment", max_len=40) or "Machine"
    if "notes" in d:
        e.notes = clean_str(d["notes"], "", "notes", max_len=500)
    if "archived" in d:
        if not isinstance(d["archived"], bool):
            raise ValueError("archived must be a boolean")
        e.archived = d["archived"]
    if "group_ids" in d:
        ids = parse_int_list(d["group_ids"], "group_ids")
        e.groups = Group.query.filter(Group.user_id == g.user.id, Group.id.in_(ids)).all() if ids else []
    db.session.commit()
    return jsonify(e.to_dict())


@app.delete("/api/exercises/<int:eid>")
@login_required
def delete_exercise(eid: int):
    db.session.delete(get_user_exercise_or_404(eid))
    db.session.commit()
    return "", 204


# ---------- groups ----------
def apply_group(gr: Group, d: dict):
    if "name" in d:
        name = clean_str(d["name"], "", "name", max_len=80)
        if name:
            dup = Group.query.filter(
                Group.user_id == g.user.id,
                func.lower(Group.name) == name.lower(),
                Group.id != gr.id,
            ).first()
            if dup:
                raise ValueError("A group with that name already exists")
        gr.name = name
    if "exercise_ids" in d:
        ids = parse_int_list(d["exercise_ids"], "exercise_ids")
        gr.exercises = Exercise.query.filter(Exercise.user_id == g.user.id, Exercise.id.in_(ids)).all() if ids else []


@app.get("/api/groups")
@login_required
def list_groups():
    groups = (
        Group.query.filter_by(user_id=g.user.id)
        .options(selectinload(Group.exercises))
        .order_by(Group.name)
        .all()
    )
    return jsonify([gr.to_dict() for gr in groups])


@app.post("/api/groups")
@login_required
def create_group():
    d = json_dict()
    if not clean_str(d.get("name"), "", "name", max_len=80):
        return jsonify(error="Group name is required"), 400
    gr = Group(user_id=g.user.id)
    apply_group(gr, d)
    db.session.add(gr)
    db.session.commit()
    return jsonify(gr.to_dict()), 201


@app.put("/api/groups/<int:gid>")
@login_required
def update_group(gid: int):
    gr = get_user_group_or_404(gid)
    apply_group(gr, json_dict())
    if not gr.name:
        return jsonify(error="Group name is required"), 400
    db.session.commit()
    return jsonify(gr.to_dict())


@app.delete("/api/groups/<int:gid>")
@login_required
def delete_group(gid: int):  # removes the group only, never its exercises
    gr = get_user_group_or_404(gid)
    gr.exercises = []
    db.session.delete(gr)
    db.session.commit()
    return "", 204


# ---------- dashboard & analytics ----------
@app.get("/api/dashboard")
@login_required
def dashboard():
    exercises = (
        Exercise.query.filter_by(user_id=g.user.id, archived=False)
        .options(selectinload(Exercise.groups), selectinload(Exercise.sessions))
        .order_by(Exercise.muscle_group, Exercise.name)
        .all()
    )
    out = []
    for e in exercises:
        d = e.to_dict()
        d["last_session"] = e.sessions[0].to_dict() if e.sessions else None
        d["stats"] = stats(e)
        d["history"] = session_progress(e)
        out.append(d)
    return jsonify(out)


@app.get("/api/analytics")
@login_required
def analytics():
    rows = (
        db.session.query(WorkoutSession.performed_at)
        .join(Exercise)
        .filter(Exercise.user_id == g.user.id)
        .order_by(WorkoutSession.performed_at.asc())
        .all()
    )
    return jsonify(workout_dates=[dt.isoformat() + "Z" for (dt,) in rows])


# ---------- sessions ----------
@app.get("/api/sessions")
@login_required
def list_sessions():
    q = (
        WorkoutSession.query.join(Exercise)
        .filter(Exercise.user_id == g.user.id)
        .options(joinedload(WorkoutSession.exercise))
    )
    eid_raw = request.args.get("exercise_id")
    if eid_raw:
        q = q.filter(WorkoutSession.exercise_id == parse_int(eid_raw, "exercise_id"))
    rows = q.order_by(WorkoutSession.performed_at.desc(), WorkoutSession.id.desc()).all()
    return jsonify([s.to_dict() for s in rows])


@app.post("/api/workouts")
@login_required
def save_workout():
    """Save one workout: [{exercise_id, sets}] -> one session per exercise, trimmed independently."""
    d = json_dict()
    when = parse_date(d.get("performed_at"))
    entries = d.get("entries", [])
    if not isinstance(entries, list):
        raise ValueError("entries must be a list")
    saved = []
    for item in entries:
        if not isinstance(item, dict):
            raise ValueError("Each entry must be an object")
        eid = parse_int(item.get("exercise_id"), "exercise_id")
        sets = [s for s in clean_sets(item.get("sets")) if s["done"] and (s["weight"] or s["reps"])]
        ex = Exercise.query.filter_by(id=eid, user_id=g.user.id).first()
        if not ex or not sets:
            continue
        s = WorkoutSession(exercise_id=ex.id, performed_at=when, sets_json=json.dumps(sets))
        db.session.add(s)
        db.session.flush()
        trim_history(ex.id)
        saved.append(ex.id)
    db.session.commit()
    return jsonify(saved=saved), 201


@app.put("/api/sessions/<int:sid>")
@login_required
def update_session(sid: int):
    s = (
        WorkoutSession.query.join(Exercise)
        .filter(WorkoutSession.id == sid, Exercise.user_id == g.user.id)
        .first()
    )
    if not s:
        abort(404)
    d = json_dict()
    if "sets" in d:
        cleaned = [r for r in clean_sets(d["sets"]) if r["weight"] or r["reps"]]
        if not cleaned:
            return jsonify(error="At least one set with weight or reps is required"), 400
        s.sets_json = json.dumps(cleaned)
    if "performed_at" in d:
        s.performed_at = parse_date(d["performed_at"])
    db.session.commit()
    return jsonify(s.to_dict())


@app.delete("/api/sessions/<int:sid>")
@login_required
def delete_session(sid: int):
    s = (
        WorkoutSession.query.join(Exercise)
        .filter(WorkoutSession.id == sid, Exercise.user_id == g.user.id)
        .first()
    )
    if not s:
        abort(404)
    db.session.delete(s)
    db.session.commit()
    return "", 204


# ---------- backup ----------
@app.get("/api/export")
@login_required
def export_data():
    exercises = (
        Exercise.query.filter_by(user_id=g.user.id)
        .options(selectinload(Exercise.groups), selectinload(Exercise.sessions))
        .all()
    )
    return jsonify(
        version=1,
        exported_at=utcnow_naive().isoformat() + "Z",
        exercises=[
            dict(
                e.to_dict(),
                groups=[gr.name for gr in e.groups],
                sessions=[dict(performed_at=s.performed_at.isoformat() + "Z", sets=s.sets) for s in e.sessions],
            )
            for e in exercises
        ],
    )


@app.post("/api/import")
@login_required
def import_data():
    d = json_dict()
    raw_exercises = d.get("exercises")
    if not isinstance(raw_exercises, list):
        return jsonify(error="Not a RepTrack backup"), 400

    # Validate and normalize the entire backup before modifying any database rows.
    parsed = []
    for ed in raw_exercises:
        if not isinstance(ed, dict):
            raise ValueError("Each exercise entry must be an object")
        name = clean_str(ed.get("name"), "", "name", max_len=120)
        if not name:
            raise ValueError("Every exercise must have a non-empty name")
        raw_groups = ed.get("groups", [])
        if not isinstance(raw_groups, list):
            raise ValueError("Exercise groups must be a list")
        gnames = [clean_str(gr, "", "group name", max_len=80) for gr in raw_groups]
        raw_sessions = ed.get("sessions", [])
        if not isinstance(raw_sessions, list):
            raise ValueError("Exercise sessions must be a list")
        sessions = []
        for s in raw_sessions[:MAX_SESSIONS]:
            if not isinstance(s, dict):
                raise ValueError("Each session must be an object")
            cleaned_sets = [r for r in clean_sets(s.get("sets")) if r["weight"] or r["reps"]]
            if not cleaned_sets:
                continue
            sessions.append((parse_date(s.get("performed_at")), cleaned_sets))
        # Sort oldest-first before insertion so autoincrement IDs align with performed_at order.
        sessions.reverse()
        parsed.append(
            dict(
                name=name,
                muscle_group=clean_str(ed.get("muscle_group"), "Other", "muscle_group", max_len=40) or "Other",
                equipment=clean_str(ed.get("equipment"), "Machine", "equipment", max_len=40) or "Machine",
                notes=clean_str(ed.get("notes"), "", "notes", max_len=500),
                archived=bool(ed.get("archived")),
                groups=[gr for gr in gnames if gr],
                sessions=sessions,
            )
        )

    user_ex_ids = [ex.id for ex in Exercise.query.filter_by(user_id=g.user.id).all()]
    user_grp_ids = [gr.id for gr in Group.query.filter_by(user_id=g.user.id).all()]
    if user_ex_ids:
        WorkoutSession.query.filter(WorkoutSession.exercise_id.in_(user_ex_ids)).delete(synchronize_session=False)
        db.session.execute(group_exercises.delete().where(group_exercises.c.exercise_id.in_(user_ex_ids)))
        Exercise.query.filter(Exercise.id.in_(user_ex_ids)).delete(synchronize_session=False)
    if user_grp_ids:
        db.session.execute(group_exercises.delete().where(group_exercises.c.group_id.in_(user_grp_ids)))
        Group.query.filter(Group.id.in_(user_grp_ids)).delete(synchronize_session=False)

    groups = {}
    for ed in parsed:
        e = Exercise(
            user_id=g.user.id,
            name=ed["name"],
            muscle_group=ed["muscle_group"],
            equipment=ed["equipment"],
            notes=ed["notes"],
            archived=ed["archived"],
        )
        db.session.add(e)
        db.session.flush()
        for gname in ed["groups"]:
            key = gname.lower()
            if key not in groups:
                groups[key] = Group(user_id=g.user.id, name=gname)
                db.session.add(groups[key])
            if e not in groups[key].exercises:
                groups[key].exercises.append(e)
        for performed_at, sets in ed["sessions"]:
            db.session.add(WorkoutSession(exercise_id=e.id, performed_at=performed_at, sets_json=json.dumps(sets)))
    db.session.commit()
    return jsonify(ok=True)


# ---------- static frontend (production SPA) ----------
@app.route("/api/<path:_>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def api_not_found(_: str):
    return jsonify(error="Not found"), 404


@app.get("/")
@app.get("/<path:path>")
def serve_spa(path: str = ""):
    if path.startswith("api/"):
        return jsonify(error="Not found"), 404
    if not DIST_DIR.is_dir():
        return jsonify(error="Frontend build not found. Run 'npm run build' in frontend/."), 404
    if path:
        target = (DIST_DIR / path).resolve()
        if target.is_file() and DIST_DIR.resolve() in target.parents:
            return send_from_directory(DIST_DIR, path)
    resp = send_from_directory(DIST_DIR, "index.html")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


def _ensure_column(table_name: str, col_name: str, col_ddl: str, unique: bool = False):
    cols = [row[1] for row in db.session.execute(text(f"PRAGMA table_info({table_name})")).fetchall()]
    if cols and col_name not in cols:
        db.session.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_ddl}"))
        idx_kind = "UNIQUE INDEX" if unique else "INDEX"
        db.session.execute(text(f"CREATE {idx_kind} IF NOT EXISTS ix_{table_name}_{col_name} ON {table_name}({col_name})"))


def init_db():
    with app.app_context():
        db.create_all()
        if db.engine.dialect.name == "sqlite":
            _ensure_column("exercise", "user_id", "INTEGER REFERENCES user(id) ON DELETE CASCADE")
            _ensure_column("workout_group", "user_id", "INTEGER REFERENCES user(id) ON DELETE CASCADE")
            _ensure_column("user", "google_sub", "VARCHAR(128)", unique=True)
            _ensure_column("user", "auth_provider", "VARCHAR(20) DEFAULT 'password'")
            _ensure_column("user", "email_verified", "BOOLEAN DEFAULT 0")
            db.session.commit()


init_db()

if __name__ == "__main__":
    host = os.environ.get("REPTRACK_HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("REPTRACK_DEBUG", "").lower() in ("1", "true", "yes")
    if debug:
        app.run(debug=True, host=host, port=port)
    else:
        from waitress import serve

        app.logger.info("Serving RepTrack in production mode on http://%s:%s", host, port)
        serve(app, host=host, port=port, threads=8)
