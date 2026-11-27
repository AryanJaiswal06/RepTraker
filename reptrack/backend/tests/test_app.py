import os
import sys
import tempfile
import unittest
import urllib.parse
import warnings
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

# Configure isolated DB before importing app
_TMP_FD, _TMP_DB = tempfile.mkstemp(suffix=".db")
os.close(_TMP_FD)
os.environ["REPTRACK_DATABASE_URI"] = f"sqlite:///{_TMP_DB}"
os.environ["REPTRACK_SEED"] = "0"

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import app as m  # noqa: E402


class RepTrackMultiUserTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        with m.app.app_context():
            m.db.session.remove()
            m.db.engine.dispose()
        if os.path.exists(_TMP_DB):
            os.remove(_TMP_DB)

    def setUp(self):
        m.app.config["TESTING"] = True
        with m.app.app_context():
            m.EmailOTP.query.delete()
            m.WorkoutSession.query.delete()
            m.db.session.execute(m.group_exercises.delete())
            m.Exercise.query.delete()
            m.Group.query.delete()
            m.User.query.delete()
            m.db.session.commit()
        self.client = m.app.test_client()

    def register(self, client, name: str, email: str, password: str = "password123"):
        start = client.post("/api/auth/register/start", json={"name": name, "email": email, "password": password})
        if start.status_code != 200:
            return start
        code = start.get_json()["dev_otp"]
        return client.post(
            "/api/auth/register/verify",
            json={"name": name, "email": email, "password": password, "code": code},
        )

    def test_health_and_security_headers(self):
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json(), {"status": "ok"})
        self.assertEqual(res.headers.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(res.headers.get("X-Frame-Options"), "DENY")
        self.assertEqual(res.headers.get("Cache-Control"), "no-store")

    def test_auth_required_and_lifecycle(self):
        self.assertEqual(self.client.get("/api/auth/me").get_json(), {"user": None})
        for ep in ("/api/exercises", "/api/groups", "/api/dashboard", "/api/sessions", "/api/export"):
            self.assertEqual(self.client.get(ep).status_code, 401)

        # Old passwordless login endpoint is removed
        self.assertEqual(self.client.post("/api/auth/otp/request", json={"email": "a@b.com"}).status_code, 404)

        # Validation errors on signup
        self.assertEqual(self.client.post("/api/auth/register/start", json={"name": "", "email": "a@b.com", "password": "password123"}).status_code, 400)
        self.assertEqual(self.client.post("/api/auth/register/start", json={"name": "A", "email": "not-email", "password": "password123"}).status_code, 400)
        self.assertEqual(self.client.post("/api/auth/register/start", json={"name": "A", "email": "a@b.com", "password": "short"}).status_code, 400)

        # Register via OTP verification, duplicate check, logout, password login, password change
        r = self.register(self.client, "Alice", "Alice@Example.com", "secret123")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.get_json()["user"]["email"], "alice@example.com")
        self.assertTrue(r.get_json()["user"]["email_verified"])
        self.assertTrue(r.get_json()["user"]["has_password"])
        self.assertEqual(self.register(self.client, "Alice2", "alice@example.com", "secret123").status_code, 409)

        self.assertEqual(self.client.get("/api/auth/me").get_json()["user"]["name"], "Alice")
        self.client.post("/api/auth/logout")
        self.assertIsNone(self.client.get("/api/auth/me").get_json()["user"])

        self.assertEqual(
            self.client.post("/api/auth/login", json={"email": "alice@example.com", "password": "wrong"}).status_code,
            401,
        )
        ok = self.client.post("/api/auth/login", json={"email": "alice@example.com", "password": "secret123"})
        self.assertEqual(ok.status_code, 200)

        self.assertEqual(
            self.client.put("/api/auth/password", json={"current_password": "wrong", "new_password": "newpass123"}).status_code,
            400,
        )
        self.assertEqual(
            self.client.put("/api/auth/password", json={"current_password": "secret123", "new_password": "newpass123"}).status_code,
            200,
        )

    def test_signup_otp_rate_limit_and_lockout(self):
        payload = {"name": "OTP User", "email": "newotp@example.com", "password": "password123"}
        req = self.client.post("/api/auth/register/start", json=payload)
        self.assertEqual(req.status_code, 200)
        code = req.get_json()["dev_otp"]
        self.assertRegex(code, r"^\d{6}$")

        # User is not created until OTP is verified
        with m.app.app_context():
            self.assertIsNone(m.User.query.filter_by(email="newotp@example.com").first())

        # Cooldown blocks immediate resend
        self.assertEqual(self.client.post("/api/auth/register/start", json=payload).status_code, 429)

        # Wrong code increments attempts until lockout
        for _ in range(m.OTP_MAX_ATTEMPTS):
            self.assertEqual(
                self.client.post("/api/auth/register/verify", json={**payload, "code": "000000"}).status_code,
                401,
            )
        self.assertEqual(
            self.client.post("/api/auth/register/verify", json={**payload, "code": code}).status_code,
            429,
        )

        # Reset cooldown and complete signup
        with m.app.app_context():
            row = m.EmailOTP.query.filter_by(email="newotp@example.com").first()
            row.created_at = row.created_at - timedelta(seconds=60)
            m.db.session.commit()

        req2 = self.client.post("/api/auth/register/start", json=payload)
        self.assertEqual(req2.status_code, 200)
        code2 = req2.get_json()["dev_otp"]

        ok = self.client.post("/api/auth/register/verify", json={**payload, "code": code2})
        self.assertEqual(ok.status_code, 201)
        self.assertTrue(ok.get_json()["user"]["email_verified"])

    def test_multi_user_isolation(self):
        c1 = m.app.test_client()
        c2 = m.app.test_client()
        self.assertEqual(self.register(c1, "Alice", "alice@test.com").status_code, 201)
        self.assertEqual(self.register(c2, "Bob", "bob@test.com").status_code, 201)

        g1 = c1.post("/api/groups", json={"name": "Push"}).get_json()
        e1 = c1.post("/api/exercises", json={"name": "Bench", "group_ids": [g1["id"]]}).get_json()
        c1.post("/api/workouts", json={"entries": [{"exercise_id": e1["id"], "sets": [{"weight": 80, "reps": 5, "done": True}]}]})
        s1 = c1.get("/api/sessions").get_json()[0]

        g2 = c2.post("/api/groups", json={"name": "Push"})
        self.assertEqual(g2.status_code, 201)

        self.assertEqual(c2.get("/api/exercises").get_json(), [])
        self.assertEqual(c2.get("/api/dashboard").get_json(), [])
        self.assertEqual(c2.get("/api/sessions").get_json(), [])
        self.assertEqual(c2.put(f"/api/exercises/{e1['id']}", json={"name": "Hacked"}).status_code, 404)
        self.assertEqual(c2.delete(f"/api/exercises/{e1['id']}").status_code, 404)
        self.assertEqual(c2.put(f"/api/groups/{g1['id']}", json={"name": "Hacked"}).status_code, 404)
        self.assertEqual(c2.delete(f"/api/groups/{g1['id']}").status_code, 404)
        self.assertEqual(c2.put(f"/api/sessions/{s1['id']}", json={"sets": [{"weight": 1, "reps": 1}]}).status_code, 404)
        self.assertEqual(c2.delete(f"/api/sessions/{s1['id']}").status_code, 404)

        b_ex = c2.post("/api/exercises", json={"name": "Squat", "group_ids": [g1["id"]]}).get_json()
        self.assertEqual(b_ex["group_ids"], [])

        c2.post("/api/import", json={"exercises": [{"name": "Bob Deadlift", "groups": ["Pull"], "sessions": []}]})
        self.assertEqual(len(c1.get("/api/exercises").get_json()), 1)
        self.assertEqual(c1.get("/api/exercises").get_json()[0]["name"], "Bench")
        self.assertEqual(len(c1.get("/api/sessions").get_json()), 1)

    def test_workout_validation_trim_and_timezone(self):
        self.register(self.client, "Alice", "alice@test.com")
        ex = self.client.post("/api/exercises", json={"name": "Squat"}).get_json()
        eid = ex["id"]

        self.assertEqual(self.client.get("/api/sessions?exercise_id=abc").status_code, 400)
        self.assertEqual(
            self.client.post("/api/workouts", json={"performed_at": "bad", "entries": []}).status_code, 400
        )
        self.assertEqual(
            self.client.post(
                "/api/workouts",
                json={"entries": [{"exercise_id": eid, "sets": [{"weight": 9999, "reps": 5, "done": True}]}]},
            ).status_code,
            400,
        )

        tz = self.client.post(
            "/api/workouts",
            json={
                "performed_at": "2026-10-01T10:00:00+05:30",
                "entries": [{"exercise_id": eid, "sets": [{"weight": 100, "reps": 5, "done": True}]}],
            },
        )
        self.assertEqual(tz.status_code, 201)
        sess = self.client.get(f"/api/sessions?exercise_id={eid}").get_json()
        self.assertEqual(sess[0]["performed_at"], "2026-10-01T04:30:00Z")

        for i in range(16):
            r = self.client.post(
                "/api/workouts",
                json={
                    "performed_at": f"2026-11-{i+1:02d}T10:00:00Z",
                    "entries": [{"exercise_id": eid, "sets": [{"weight": 60 + i, "reps": 5, "done": True}]}],
                },
            )
            self.assertEqual(r.status_code, 201)

        sessions = self.client.get(f"/api/sessions?exercise_id={eid}").get_json()
        self.assertEqual(len(sessions), 15)
        self.assertEqual(sessions[0]["performed_at"], "2026-11-16T10:00:00Z")
        self.assertEqual(sessions[-1]["performed_at"], "2026-11-02T10:00:00Z")
        self.assertEqual(self.client.put(f"/api/sessions/{sessions[0]['id']}", json={"sets": []}).status_code, 400)

    def test_export_import_rollback_and_no_deprecation_warnings(self):
        self.register(self.client, "Alice", "alice@test.com")
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always", DeprecationWarning)
            ex = self.client.post("/api/exercises", json={"name": "Row"}).get_json()
            self.client.post(
                "/api/workouts",
                json={"entries": [{"exercise_id": ex["id"], "sets": [{"weight": 50, "reps": 10, "done": True}]}]},
            )
            exp = self.client.get("/api/export").get_json()
            self.assertTrue(exp["exercises"][0]["sessions"][0]["performed_at"].endswith("Z"))

            self.assertEqual(self.client.post("/api/import", json={"exercises": [{"bad": 1}]}).status_code, 400)
            self.assertEqual(len(self.client.get("/api/exercises").get_json()), 1)

            self.assertEqual(self.client.post("/api/import", json=exp).status_code, 200)
            self.assertEqual(len(self.client.get("/api/sessions").get_json()), 1)

            app_deprecations = [x for x in w if "app.py" in (x.filename or "")]
            self.assertEqual(app_deprecations, [])

    def test_unknown_api_route_returns_json_404(self):
        res = self.client.get("/api/does-not-exist")
        self.assertEqual(res.status_code, 404)
        self.assertIn("error", res.get_json())

    def test_progress_history_and_analytics_isolation(self):
        self.assertEqual(self.client.get("/api/analytics").status_code, 401)
        c1 = m.app.test_client()
        c2 = m.app.test_client()
        self.register(c1, "Alice", "alice@test.com")
        self.register(c2, "Bob", "bob@test.com")

        ex = c1.post("/api/exercises", json={"name": "Bench"}).get_json()
        c1.post(
            "/api/workouts",
            json={
                "performed_at": "2026-11-20T10:00:00Z",
                "entries": [{"exercise_id": ex["id"], "sets": [{"weight": 60, "reps": 10, "done": True}]}],
            },
        )
        c1.post(
            "/api/workouts",
            json={
                "performed_at": "2026-11-24T10:00:00Z",
                "entries": [{"exercise_id": ex["id"], "sets": [{"weight": 75, "reps": 6, "done": True}]}],
            },
        )

        dash = c1.get("/api/dashboard").get_json()
        hist = dash[0]["history"]
        self.assertEqual(len(hist), 2)
        self.assertEqual(hist[0]["date"], "2026-11-20T10:00:00Z")
        self.assertEqual(hist[0]["best_weight"], 60.0)
        self.assertEqual(hist[0]["volume"], 600.0)
        self.assertEqual(hist[0]["est_1rm"], 80.0)
        self.assertEqual(hist[1]["best_weight"], 75.0)
        self.assertEqual(hist[1]["volume"], 450.0)
        self.assertEqual(hist[1]["est_1rm"], 90.0)

        self.assertEqual(len(c1.get("/api/analytics").get_json()["workout_dates"]), 2)
        self.assertEqual(c2.get("/api/analytics").get_json()["workout_dates"], [])

    def test_google_oauth_flow_and_set_password(self):
        self.assertEqual(
            self.client.get("/api/auth/providers").get_json(),
            {"google_enabled": False, "smtp_enabled": False},
        )
        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": "cid", "GOOGLE_CLIENT_SECRET": "csec"}):
            self.assertTrue(self.client.get("/api/auth/providers").get_json()["google_enabled"])
            start = self.client.get("/api/auth/google/start")
            self.assertEqual(start.status_code, 302)
            loc = start.headers["Location"]
            self.assertTrue(loc.startswith("https://accounts.google.com/o/oauth2/v2/auth?"))

            bad_cb = self.client.get("/api/auth/google/callback?state=wrong&code=abc")
            self.assertEqual(bad_cb.status_code, 302)
            self.assertIn("auth_error=", bad_cb.headers["Location"])

            start2 = self.client.get("/api/auth/google/start")
            state2 = urllib.parse.parse_qs(urllib.parse.urlparse(start2.headers["Location"]).query)["state"][0]
            fake_info = {
                "sub": "google-sub-123",
                "email": "guser@example.com",
                "email_verified": True,
                "name": "Google User",
            }
            with patch.object(m, "exchange_google_code", return_value=fake_info):
                cb = self.client.get(f"/api/auth/google/callback?state={state2}&code=valid-code")
                self.assertEqual(cb.status_code, 302)
                self.assertEqual(urllib.parse.urlparse(cb.headers["Location"]).path, "/")

            me = self.client.get("/api/auth/me").get_json()["user"]
            self.assertEqual(me["email"], "guser@example.com")
            self.assertEqual(me["auth_provider"], "google")
            self.assertTrue(me["email_verified"])
            self.assertFalse(me["has_password"])

            # Google user can optionally set a password in Settings
            set_pw = self.client.put("/api/auth/password", json={"new_password": "newpassword123"})
            self.assertEqual(set_pw.status_code, 200)
            self.assertTrue(set_pw.get_json()["user"]["has_password"])

    def test_postgres_database_uri_normalization(self):
        self.assertEqual(
            m.normalize_database_uri("postgres://user:pass@db.host:5432/reptrack?sslmode=require"),
            "postgresql+psycopg://user:pass@db.host:5432/reptrack?sslmode=require",
        )
        self.assertEqual(
            m.normalize_database_uri("postgresql://user:pass@db.host:5432/reptrack"),
            "postgresql+psycopg://user:pass@db.host:5432/reptrack",
        )
        self.assertEqual(
            m.normalize_database_uri("postgresql+psycopg://user:pass@db.host:5432/reptrack"),
            "postgresql+psycopg://user:pass@db.host:5432/reptrack",
        )
        self.assertEqual(m.normalize_database_uri("sqlite:///reptrack.db"), "sqlite:///reptrack.db")


if __name__ == "__main__":
    unittest.main()
