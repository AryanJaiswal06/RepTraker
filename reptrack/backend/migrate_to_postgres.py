"""One-time migration helper: copy users, groups, exercises, and sessions from SQLite to hosted PostgreSQL."""
import argparse
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as m  # noqa: E402


def parse_ts(val: str | None) -> datetime:
    if not val:
        return m.utcnow_naive()
    return datetime.fromisoformat(val.replace("Z", "+00:00")).replace(tzinfo=None)


def migrate(sqlite_path: Path, force: bool = False):
    if not sqlite_path.is_file():
        raise SystemExit(f"SQLite source file not found: {sqlite_path}")

    src = sqlite3.connect(sqlite_path)
    src.row_factory = sqlite3.Row

    with m.app.app_context():
        if m.db.engine.dialect.name != "postgresql":
            raise SystemExit(
                "Target database is not PostgreSQL. Set DATABASE_URL or REPTRACK_DATABASE_URI in backend/.env first."
            )
        m.db.create_all()
        has_data = m.User.query.first() or m.Exercise.query.first() or m.Group.query.first()
        if has_data and not force:
            raise SystemExit("Target PostgreSQL database already contains data. Pass --force to clear and re-import.")

        if force:
            m.WorkoutSession.query.delete()
            m.db.session.execute(m.group_exercises.delete())
            m.Exercise.query.delete()
            m.Group.query.delete()
            m.EmailOTP.query.delete()
            m.User.query.delete()
            m.db.session.commit()

        users = src.execute("SELECT * FROM user").fetchall()
        for r in users:
            m.db.session.add(
                m.User(
                    id=r["id"],
                    email=r["email"],
                    name=r["name"],
                    password_hash=r["password_hash"] or "",
                    google_sub=r["google_sub"] if "google_sub" in r.keys() else None,
                    auth_provider=r["auth_provider"] if "auth_provider" in r.keys() else "password",
                    email_verified=bool(r["email_verified"]) if "email_verified" in r.keys() else False,
                    created_at=parse_ts(r["created_at"]),
                )
            )

        groups = src.execute("SELECT * FROM workout_group").fetchall()
        for r in groups:
            m.db.session.add(m.Group(id=r["id"], user_id=r["user_id"], name=r["name"]))

        exercises = src.execute("SELECT * FROM exercise").fetchall()
        for r in exercises:
            m.db.session.add(
                m.Exercise(
                    id=r["id"],
                    user_id=r["user_id"],
                    name=r["name"],
                    muscle_group=r["muscle_group"],
                    equipment=r["equipment"],
                    notes=r["notes"],
                    archived=bool(r["archived"]),
                )
            )
        m.db.session.flush()

        links = src.execute("SELECT group_id, exercise_id FROM group_exercises").fetchall()
        for r in links:
            m.db.session.execute(
                m.group_exercises.insert().values(group_id=r["group_id"], exercise_id=r["exercise_id"])
            )

        sessions = src.execute("SELECT * FROM workout_session").fetchall()
        for r in sessions:
            m.db.session.add(
                m.WorkoutSession(
                    id=r["id"],
                    exercise_id=r["exercise_id"],
                    performed_at=parse_ts(r["performed_at"]),
                    sets_json=r["sets_json"],
                )
            )
        m.db.session.commit()

        # Sync PostgreSQL sequences so future inserts don't collide with migrated primary keys.
        for tbl in ("user", "workout_group", "exercise", "workout_session"):
            m.db.session.execute(
                text(
                    f'SELECT setval(pg_get_serial_sequence(\'"{tbl}"\', \'id\'), '
                    f'COALESCE((SELECT MAX(id) FROM "{tbl}"), 1), true)'
                )
            )
        m.db.session.commit()

    src.close()
    print(f"Migrated {len(users)} users, {len(groups)} groups, {len(exercises)} exercises, {len(sessions)} sessions to PostgreSQL.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate RepTrack SQLite database to hosted PostgreSQL.")
    parser.add_argument(
        "--sqlite",
        default=str(Path(__file__).resolve().parent / "instance" / "reptrack.db"),
        help="Path to source SQLite database",
    )
    parser.add_argument("--force", action="store_true", help="Clear target PostgreSQL tables before migrating")
    args = parser.parse_args()
    migrate(Path(args.sqlite), force=args.force)
