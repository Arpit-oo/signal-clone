# Signal Clone

A recreation of Signal’s public homepage, paired with a working Signal-inspired messaging app built with Next.js/TypeScript, FastAPI, SQLite, and real-time WebSockets. Source, dependencies, browser binaries, data, logs, and test artifacts stay inside this project.

## Start on Windows

Requires Node.js 22.12+ (or a supported newer release), Python 3.12+, and `uv` on PATH. The launch scripts run from any working directory.

```powershell
cd F:\signal-clone
.\scripts\setup.ps1 -BrowserTests
.\scripts\start.ps1
```

Open **http://127.0.0.1:3000** for the homepage. Select **Get Signal → Open web messenger**, or visit **http://127.0.0.1:3000/chats** directly. Choose Alex, Priya, or Marcus on the login screen, continue, and enter the displayed demo code **123456**. Use another browser profile or private window to sign in as a second person and exchange messages in real time.

| Account | Phone |
| --- | --- |
| Alex Rivera | +15550000001 |
| Priya Sharma | +15550000002 |
| Marcus Chen | +15550000003 |

A new phone number opens profile setup and creates a Note to Self conversation. Search registered people by name, username, or phone to start a chat.

```powershell
.\scripts\stop.ps1
.\scripts\start.ps1 -Production
```

Production mode builds the frontend and runs `next start`. Services run in hidden background processes; logs and PID records are in `.runtime/`. The stop script verifies project ownership and process start times before stopping those services. Launch checks ports 3000 and 8000 and waits for both servers to respond. If another project occupies port 3000, choose a free port with `.\scripts\start.ps1 -Production -FrontendPort 3010`. The script prints the actual preview URL and preserves unrelated processes.

If PowerShell policy prevents local scripts, use `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start.ps1` for that invocation.

## Implemented behavior

- Reference homepage at `/`, responsive navigation, keyboard-accessible language selector, local fonts/images, real official support/donation/download links, and a local messenger entry at `/download`.
- Phone verification, persistent login, new-account onboarding, profile names/usernames/about text, avatar uploads and colors.
- Direct and group conversations, contacts and nicknames, blocking, group photos/descriptions, adding/removing members, admin roles, and leaving groups.
- Real-time messages, typing and presence, optimistic sends, failed-send retry, reconnect recovery, delivery and read receipts.
- Replies, reactions, editing, forwarding, message information, deletion for yourself or everyone, pagination and search.
- Images, videos, audio, downloadable files, and microphone voice notes with preview. Microphone access requires browser permission.
- Pinning, archiving, muting, unread filters, Note to Self, and disappearing-message timers.
- Light/dark/system theme, chat colors, message text size, notification privacy, typing/read-receipt privacy, and keyboard preferences.
- Desktop and mobile layouts, keyboard-accessible controls/dialogs, loading states, and actionable errors.

Phone verification uses a fixed mock OTP; no SMS is sent. Messages and uploads are stored on the local server without Signal's end-to-end encryption. Voice/video calling and multi-device linking are outside the implemented scope.

## Local files and configuration

| Path | Contents |
| --- | --- |
| `frontend/src/` | Pages, UI, API/WebSocket clients, and Zustand stores |
| `backend/app/` | Routes, service rules, persistence models, and real-time events |
| `backend/alembic/` | Checked-in database migrations |
| `backend/data/` | SQLite database and uploaded media |
| `backend/.venv/`, `frontend/node_modules/` | Installed project dependencies |
| `.cache/` | npm/uv downloads, managed Python, browsers, and backend test data |
| `.runtime/` | Service logs/PIDs and isolated browser-test databases |
| `frontend/tests/`, `backend/tests/` | Regression tests |

Setup creates an ignored `backend/.env` with a random JWT secret, automatic migrations, and demo seeding, plus `frontend/.env.local` from its example. Existing environment files are preserved. Migrations run before serving; seeding runs only on an empty database, so restarting preserves conversations.

`API_ORIGIN` is the frontend server's REST/media proxy target. `NEXT_PUBLIC_WS_URL` is the browser's WebSocket base URL (without `/ws`). Changing browser-facing variables requires rebuilding production assets. Examples and backend settings are documented in [backend/README.md](backend/README.md) and [frontend/README.md](frontend/README.md).

The messenger uses local SVG icons, system fonts, and generated seed images. The homepage serves its reference artwork and Inter fonts from `frontend/public/signal/`; attribution is documented there. It needs no third-party image/font services to build or render. Homepage copy describes the official Signal product; the local demo’s limitations are stated on its entry and login screens.

## Verification

```powershell
.\scripts\verify.ps1 -BrowserTests
```

This runs backend Ruff/pytest, frontend ESLint/TypeScript, frontend unit tests, a production build, and Playwright Chromium tests. Browser tests start servers on ports **3001/8001** with an isolated database; they preserve the running app and its data.

Individual commands:

```powershell
cd backend
uv run --locked pytest -q
uv run --locked ruff check .
cd ../frontend
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Backend tests cover authentication, history visibility, message operations, concurrent retries and upload claims, media permissions, receipts, groups, malformed WebSocket events, migrations, and seed idempotency. Frontend unit tests cover duplicate delivery, monotonic receipts, racing page loads/search jumps, upload previews, offline sends/uploads, failed reads, and session recovery. Browser tests exercise the homepage with the API unavailable, responsive navigation, language-dialog focus, separate messaging sessions, groups, settings, new accounts, history resizing, attachment drafts, and microphone failures.

`npm audit --omit=dev` checks production dependencies. The full audit currently reports a development-only `braces` issue through Next's ESLint tooling; [the upstream advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) lists no patched version. The project retains the matching Next/ESLint release.

## Manual startup on other platforms

```sh
cd backend
UV_CACHE_DIR=../.cache/uv UV_PYTHON_INSTALL_DIR=../.cache/python uv sync --locked
SEED_ON_STARTUP=true uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In another terminal:

```sh
cd frontend
npm ci --cache ../.cache/npm
cp .env.example .env.local
npm run dev
```

For browser tests, run `PLAYWRIGHT_BROWSERS_PATH=../.cache/playwright npx playwright install chromium` first. SQLite/upload paths resolve from the backend folder regardless of launch directory. Interactive API docs: http://127.0.0.1:8000/docs.
