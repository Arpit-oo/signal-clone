# Signal Clone

A recreation of Signal’s public homepage, paired with a working Signal-inspired messaging app built with Next.js/TypeScript, FastAPI, SQLite, and real-time WebSockets. Use Docker Compose for a containerized setup, or the local scripts to keep dependencies, browsers, data, logs, and test artifacts inside this project.

## Live demo

- **App:** https://signal-clone-ochre-one.vercel.app (messenger at `/chats`)
- **API:** https://signal-clone-api-bnvj.onrender.com ([interactive docs](https://signal-clone-api-bnvj.onrender.com/docs))

Sign in as Alex (`+15550000001`), Priya (`+15550000002`), or Marcus (`+15550000003`) with the code **123456**. Use a second browser profile or private window to chat between two accounts in real time.

The frontend runs on Vercel and proxies REST calls to the FastAPI backend on Render's free plan (`render.yaml`). The free plan has no persistent disk and sleeps after 15 idle minutes: the first request after a pause can take about a minute, and the SQLite database and uploads reset to the seed data whenever the service restarts.

## Start with Docker

Requires Docker with Linux containers and Docker Compose v2. From the repository root:

```sh
docker compose up --build -d --wait
```

Open **http://localhost:3000**; the API docs are at **http://localhost:8000/docs**. Sign in with a seeded account below and code **123456**, or create your own account at `/signup`. No local Node.js, Python, or `uv` installation is needed to run the containers.

Both images use locked dependencies and run as non-root users. Compose waits for backend health before starting the production Next.js server. SQLite, uploads, and an automatically generated session-signing secret persist in the `backend-data` named volume. Migrations run on startup and demo data is seeded only when the database is empty. The container data is separate from `backend/data/` used by the Windows scripts.

```sh
docker compose ps
docker compose logs -f
docker compose down
```

`down` stops/removes the containers and retains the data volume. Running the startup command again restores the same accounts, messages, uploads, and signing secret. Optional ports, browser WebSocket URL, and secret overrides are in the root [.env.example](.env.example); copy it to `.env` to customize. Stop local services sharing ports 3000/8000, or choose other ports. See [DOCKER.md](DOCKER.md) for configuration, rebuilding, persistence, and troubleshooting.

## Start on Windows

Requires Node.js 22.12+ (or a supported newer release), Python 3.12+, and `uv` on PATH. The launch scripts run from any working directory.

```powershell
cd F:\signal-clone
.\scripts\setup.ps1 -BrowserTests
.\scripts\start.ps1
```

Open **http://127.0.0.1:3000** for the homepage. Use **Open messenger**, **Sign in**, or **Create account** in the navigation, or visit **http://127.0.0.1:3000/chats** directly. Choose Alex, Priya, or Marcus on the login screen, continue, and enter the displayed verification code **123456**. Use another browser profile or private window to sign in as a second person and exchange messages in real time.

| Account | Phone |
| --- | --- |
| Alex Rivera | +15550000001 |
| Priya Sharma | +15550000002 |
| Marcus Chen | +15550000003 |

At `/signup`, use your own phone number with its country code, enter the displayed simulated verification code, and set your name, optional username, and photo. A new account starts with Note to Self and its own contacts and conversations. Search registered people by name, or use the exact phone/username lookup in New conversation. Pin chats from their row, menu, or details panel; pins belong to your account and survive reloads. Signed-in users visiting signup can choose **Use another number**.

All page URLs, navigation behavior, and the complete backend endpoint inventory are listed in [ROUTES.md](ROUTES.md). Individual conversations have `/chats/{id}` URLs; details use `?details=1`. Refresh and browser Back/Forward retain the selected conversation.

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
- Real-time messages, typing and presence, optimistic sends, failed-send retry, reconnect recovery, and delivery/read receipts. Delivery acknowledges messages actually received through socket events or fetched history; opening a socket alone does not mark pending messages delivered.
- Replies, reactions, editing, forwarding, message information, deletion for yourself or everyone, pagination and search.
- Images, videos, audio, downloadable files, and microphone voice notes with preview. Microphone access requires browser permission.
- Pinning, archiving, muting, unread filters, Note to Self, and disappearing-message timers.
- Stories at `/stories`: text, photo, and video posts shared with explicitly selected people, 24-hour expiry, viewing receipts, and author deletion. Reply opens a direct chat with the author. Story media requires an authorized session; blocks apply in both directions.
- Light/dark/system theme, chat colors, message text size, notification privacy, typing/read-receipt privacy, and keyboard preferences.
- Desktop and mobile layouts, keyboard-accessible controls/dialogs, loading states, and actionable errors.

Phone verification uses a fixed mock OTP; no SMS is sent. Messages and uploads are stored on the local server without Signal's end-to-end encryption. Voice/video calling and multi-device linking are outside the implemented scope.

## Architecture and database

Next.js serves the public website and authenticated messaging screens. The typed REST client sends bearer-token requests through the Next `/api/*` proxy to FastAPI. A single shared WebSocket per browser tab handles messages, receipts, typing, presence, and change notifications. Both REST and WebSocket handlers use backend services to enforce membership and privacy rules before reading or updating SQLite through async SQLAlchemy. Alembic migrations preserve existing data. Files live on disk, with their metadata and access relationships in SQLite.

The server runs as one worker because presence and WebSocket connections are held in memory. SQLite uses foreign keys and WAL mode. Client retry IDs prevent duplicate messages; unique conversation identity keys prevent duplicate direct chats. Browser preferences persist locally, while conversations, contacts, profile data, and Stories persist on the server.

The frontend separates screen composition from asynchronous behavior:

| Location | Responsibility |
| --- | --- |
| `components/AppShell.tsx`, `components/shell/` | Compose the navigation, conversation list, selected chat, menus, and dialogs |
| `hooks/shell/` | Resolve conversation routes, cancel stale searches, manage menu focus, and coordinate chat-list actions |
| `components/chat/ChatPane.tsx` | Compose a conversation; its keyed boundary resets transient state when switching chats |
| `components/chat/useTimelineScroll.ts` | Preserve visible messages across pagination, media loading, and resizing; acknowledge visible history |
| `components/chat/useConversationActions.ts` | Handle reply/edit context, reactions, message dialogs, and failures |
| `stores/`, `lib/ws.ts`, `components/Providers.tsx` | Own shared session/chat state, the single socket, subscriptions, and reconnect recovery |
| `app/styles/`, `components/chat/chat.css` | Organize shared shell styles and chat styles; ordered shell imports keep responsive overrides last |

These paths are relative to `frontend/src/`. UI components reuse the shared stores and socket rather than opening their own real-time connections.

| Table | Key and relationships | Purpose |
| --- | --- | --- |
| `users` | `id`; unique phone and username | Profiles, privacy preferences, last seen |
| `contacts` | `(owner_id, contact_id)` → users | Per-account contacts and nicknames |
| `blocks` | `(blocker_id, blocked_id)` → users | Privacy/access restrictions |
| `conversations` | `id`; creator → users; unique optional identity key | Direct, group, and Note to Self metadata |
| `conversation_members` | `(conversation_id, user_id)` | Roles, membership/history boundaries, read cursor, pins, archive/mute state |
| `messages` | `id`; conversation/sender/reply references; unique client ID | Text/system content, edits/deletion, disappearing timers |
| `message_receipts` | `(message_id, user_id)` | Delivery and read timestamps per recipient |
| `message_hidden` | `(message_id, user_id)` | Delete-for-me visibility |
| `message_mentions` | `(message_id, user_id)` | Mention lookup |
| `reactions` | `(message_id, user_id)` | One emoji reaction per user per message |
| `attachments` | `id`; message and uploader references | Stored-file metadata; uploads are claimed when a message is sent |
| `stories` | `id`; author → users; expiry index | Text/media content, storage metadata, creation and expiry |
| `story_recipients` | `(story_id, user_id)` | Explicit audience fixed when the story is published |
| `story_views` | `(story_id, user_id)` → story recipient | Idempotent first-view timestamp and seen state |

Story feeds and downloads reject expired or blocked posts immediately; the background sweeper removes expired records and files. Authors can see only viewing receipts permitted by the existing read-receipts setting. The selected audience is visible only to the author. This iteration supports sharing with selected individuals; group-story distribution and drawing/sticker tools are outside this implementation.

## API overview

REST requests use `/api` on both the frontend proxy and FastAPI. Protected endpoints require `Authorization: Bearer {sessionToken}`. Attachment and Story media endpoints also accept `?token={sessionToken}` for browser image/audio/video elements; the server checks the same membership and audience permissions. Request schemas, responses, and query parameters are available at [the local API docs](http://127.0.0.1:8000/docs), with the complete endpoint inventory in [ROUTES.md](ROUTES.md).

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/request-otp`, `/api/auth/verify` | Start phone verification and obtain a session; fixed OTP `123456` |
| `GET`, `PATCH` | `/api/me` | Read/update your profile and privacy preferences |
| `GET` | `/api/users/search`, `/api/users/lookup` | Discover registered people by name or exact phone/username |
| `GET`, `POST` | `/api/contacts` | List or add your contacts |
| `GET`, `POST` | `/api/conversations` | List chats or create a direct/group conversation |
| `GET`, `PATCH` | `/api/conversations/{id}` | Read authorized chat details or update group metadata |
| `PATCH` | `/api/conversations/{id}/settings` | Set your pin, archive, mute, and unread preferences |
| `POST` | `/api/conversations/{id}/members` | Add group members; member-specific `PATCH`/`DELETE` manage roles/removal |
| `GET`, `POST` | `/api/conversations/{id}/messages` | Page through persistent history or send a message |
| `GET` | `/api/search`, `/api/conversations/{id}/messages/search` | Search across your data or within one conversation |
| `POST` | `/api/messages/delivered`, `/api/conversations/{id}/read` | Acknowledge received messages and advance the read cursor |
| `PATCH`, `DELETE` | `/api/messages/{id}` | Edit your message or delete for yourself/everyone |
| `PUT`, `DELETE` | `/api/messages/{id}/reaction` | Set/remove your emoji reaction |
| `POST`, `GET` | `/api/messages/{id}/forward`, `/api/messages/{id}/info` | Forward a visible message or inspect your sent-message receipts |
| `POST` | `/api/attachments` | Upload multipart files for a subsequent message |
| `GET`, `POST` | `/api/stories` | List visible Stories or publish multipart text/media with an explicit audience |
| `POST`, `GET` | `/api/stories/{id}/views` | Record a view or list privacy-permitted viewers of your Story |
| `DELETE` | `/api/stories/{id}` | Delete your Story and its media |

For example, sending text through `POST /api/conversations/{id}/messages` uses:

```json
{"client_id":"unique-client-message-id","body":"Hello!"}
```

The response includes the persisted message ID, echoed `client_id`, server timestamp, and sender-visible status. Retrying the same `client_id` returns the existing message. Replies add `reply_to_id`; uploaded files add `attachment_ids`. History supports `before`, `after`, and `around` message IDs for paging and search jumps. Uploads remain private until claimed by an authorized send.

Real-time clients connect to `ws://127.0.0.1:8000/ws?token={sessionToken}` and exchange `{type, data}` JSON frames. The same send above uses:

```json
{"type":"message.send","data":{"conversation_id":12,"client_id":"unique-client-message-id","body":"Hello!"}}
```

`message.new` acknowledges the send and notifies recipients; matching `client_id` replaces the optimistic message. Clients send `typing.start`/`typing.stop`, `receipt.delivered` with `message_ids`, and `receipt.read` with `conversation_id`/`up_to_id`. The server emits message/reaction/receipt changes, presence, conversation/profile changes, and `story.changed` notifications. On reconnection the client reloads authorized conversation/history data and retries queued sends. REST errors use FastAPI's `detail` field; socket failures use `error` frames referencing the rejected event.

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

The messenger uses local SVG icons, Inter fonts with system fallbacks, and generated seed images. The user-provided official desktop/mobile screens guide the layout, and the official [Signal Desktop](https://github.com/signalapp/Signal-Desktop) and [Signal Server](https://github.com/signalapp/Signal-Server) repositories were consulted for interaction and acknowledgement behavior. Application code remains an independent Next.js/FastAPI implementation. The homepage serves its reference artwork and Inter fonts from `frontend/public/signal/`; attribution is documented there. It needs no third-party image/font services to build or render. Homepage copy describes the official Signal product; the local messenger’s limitations are stated on its entry and login screens.

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

Backend tests cover authentication, history visibility, message operations, concurrent retries and upload claims, media permissions, receipts, groups, malformed WebSocket events, migrations, seed idempotency, Story audiences/expiry/receipt privacy/restart persistence, and Docker signing-secret creation/reuse/concurrency/overrides. Frontend unit tests cover duplicate delivery, monotonic receipts, racing page loads/search jumps, upload previews, offline sends/uploads, failed reads, and session recovery. Browser tests exercise the homepage with the API unavailable, responsive navigation, language-dialog focus, separate messaging sessions, groups, settings, new accounts, short-screen onboarding, history resizing, late search responses, search retries, unloaded-history jumps, menu focus, attachment drafts, microphone failures, live Stories, photo/video playback, private receipts, and closing a dialog before its response arrives.

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
