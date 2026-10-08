# Signal Clone backend

FastAPI, SQLite, and WebSockets power the local messaging app. Requires Python 3.12+ and `uv`.

## Run

From the project root, use the launch scripts documented in the root README. To run just the API from PowerShell:

```powershell
cd backend
$env:UV_CACHE_DIR = (Join-Path (Split-Path (Get-Location)) '.cache/uv')
uv sync --locked
$env:SEED_ON_STARTUP = 'true'
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The virtual environment is `backend/.venv`; the database and uploaded files stay in `backend/data`. Startup creates missing database directories and applies the checked-in Alembic migrations before serving requests. Demo seeding only runs on an empty database and preserves existing accounts and messages on later starts.

Open [interactive API docs](http://127.0.0.1:8000/docs) or [health](http://127.0.0.1:8000/health). Sign in as Alex Rivera with `+15550000001` and code `123456`; Priya Sharma is `+15550000002`. Any valid new phone number also accepts the same demo code and opens profile setup.

Copy `.env.example` to `.env` to change settings. The API reads `backend/.env` regardless of the launch directory. Relevant settings:

| Setting | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | SQLite in `backend/data/signal.db` | Persistent database |
| `UPLOAD_DIR` | `backend/data/uploads` | Attachments and avatars |
| `AUTO_MIGRATE_ON_STARTUP` | `true` | Apply schema migrations before serving |
| `SEED_ON_STARTUP` | `false` | Add demo data to an empty database |
| `CORS_ORIGINS` | localhost and 127.0.0.1 on port 3000 | Allowed browser origins, as a JSON array |
| `MAX_UPLOAD_BYTES` | `26214400` | Maximum attachment size, 25 MiB |
| `JWT_SECRET` | Local development secret | Authentication token signing key |

You can also run `uv run python -m app.seed` to migrate and seed an empty database. `uv run python -m app.seed --reset` deletes existing messages and accounts before recreating demo data. Manage schema versions explicitly with `uv run alembic upgrade head` when startup migrations are disabled.

## Messaging

REST routes use `/api` and bearer tokens from `POST /api/auth/verify`. The WebSocket endpoint is `/ws?token=...`; frames use `{"type": "message.send", "data": {...}}`. The server supports sending, acknowledgments, typing, presence, delivery/read receipts, reactions, edits, deletion, forwarding, group membership, disappearing messages, search, contacts, blocking, and profile/avatar updates. See the interactive docs for REST schemas and `app/ws/router.py` for event names.

Client IDs make message retries idempotent within the original sender's conversation. Timeline visibility also governs attachment downloads, reply previews, and WebSocket message updates. Newly added group members cannot access earlier history; removed members retain their earlier history. Clearing a chat or deleting a message locally hides its attachment for that user. A read cursor must reference a visible message in the same chat.

Authentication uses a fixed mock OTP. Message contents and attachments are stored without Signal's end-to-end encryption. This is a local demonstration of messaging behavior.

## Verify

```powershell
uv run pytest -q
uv run ruff check .
```

The regression suite covers REST authentication, conversations, message operations, attachment permissions, WebSocket events, and fresh database startup with idempotent demo seeding. Test databases and temporary files remain inside the project caches.
