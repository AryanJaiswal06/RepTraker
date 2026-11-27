# RepTrack
Your workouts. Your progress. One simple screen.

## Run in Production (single server)

Build the frontend and start the Waitress WSGI server (serves both `/api` and the built React app on one port):

```bash
cd frontend
npm install
npm run build

cd ../backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py                                        # http://127.0.0.1:5000
```

### Environment variables
- `DATABASE_URL` (or `REPTRACK_DATABASE_URI`): Hosted PostgreSQL connection URL (e.g. `postgresql://user:pass@host:5432/reptrack?sslmode=require`); falls back to local `sqlite:///reptrack.db` if omitted. Both `postgres://` and `postgresql://` URLs are automatically normalized to `postgresql+psycopg://`.
- `PORT`: server port (default `5000`)
- `REPTRACK_HOST`: bind host (default `127.0.0.1`; set `0.0.0.0` to expose on your LAN)
- `REPTRACK_SECRET_KEY`: Flask session signing secret (auto-generated and persisted in `backend/instance/.secret_key` if omitted)
- `REPTRACK_COOKIE_SECURE`: set `1` when serving over HTTPS
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_TLS`, `SMTP_SSL`: SMTP credentials for sending 6-digit email verification OTP codes when creating a new account (when `SMTP_HOST` is omitted on `127.0.0.1`, local test OTPs are logged and shown on the sign-up screen)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`: Google OAuth 2.0 credentials for **Continue with Google** (authorized redirect URI: `http://127.0.0.1:5000/api/auth/google/callback`)
- `REPTRACK_DEBUG`: set `1` only for local Flask auto-reload debugging
- `REPTRACK_SEED`: set `0` to disable default starter exercises for new accounts
- `REPTRACK_STATIC_DIR`: path to built frontend assets (default `../frontend/dist`)

## Run in Development (two terminals)

**Backend** (Python 3.10+)
```bash
cd backend
.venv\Scripts\activate                               # Linux/macOS: source .venv/bin/activate
set REPTRACK_DEBUG=1 && python app.py                # PowerShell: $env:REPTRACK_DEBUG="1"; python app.py
```
The SQLite database (`backend/instance/reptrack.db`) is created with WAL mode and seeded on first run.

**Frontend** (Node 18+)
```bash
cd frontend
npm install
npm run dev                                          # http://localhost:5173
```
Vite proxies `/api` to Flask on port `5000`.

## Tests & Checks

```bash
# Backend unit tests
cd backend && python -m unittest discover -s tests

# Frontend typecheck & production bundle
cd frontend && npm run build
```

## How it works
- **Dashboard**: expand an exercise, pre-filled from your previous session, tick completed sets, and save individually (`Complete exercise`) or together (`Complete workout` / `Complete [group]`).
- **Inline group additions**: click `Add to [group]` (or `Add exercise`) right on the Dashboard to add existing exercises or create a new one straight into the active group.
- **Groups**: organize routines like Push, Pull, or Legs. Deleting a group keeps all exercises and history.
- **Extras**: automatic rest timer with completion chime, PR detection, "Done today" badge, exercise notes, JSON backup export/import, and offline-resilient draft persistence.
- **History**: capped at 15 sessions per exercise; oldest sessions are trimmed per exercise (`trim_history` in `backend/app.py`).
- **Weights**: stored in kg; the kg/lb toggle converts display and entry while preserving decimal precision.

## Hosted PostgreSQL Setup & Migration

1. Create a hosted PostgreSQL database (Neon, Supabase, Render, Railway, etc.) and copy its connection string.
2. Create `backend/.env` (see `backend/.env.example`) and set `DATABASE_URL`:
   ```bash
   DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
   ```
3. *(Optional)* Migrate existing local SQLite data (`backend/instance/reptrack.db`) into your hosted PostgreSQL database:
   ```bash
   cd backend
   python migrate_to_postgres.py
   ```
4. Start the server (`python app.py`) — tables are created automatically on startup and connections use `pool_pre_ping` + `pool_recycle` for hosted/serverless resilience.
