# Docker setup

Docker Compose runs two production containers: a standalone Next.js frontend and a single-worker FastAPI backend. SQLite needs no separate database container. Requires Docker Engine/Desktop with Linux containers and Docker Compose v2.

## Run

From the repository root:

```sh
docker compose up --build -d --wait
```

Open http://localhost:3000 and use a seeded phone with mock OTP `123456`: Alex `+15550000001`, Priya `+15550000002`, or Marcus `+15550000003`. Own-number registration is available at `/signup`. Use a second browser profile/private window to test live messaging between accounts. API docs: http://localhost:8000/docs.

The first build downloads base images and locked npm/Python dependencies. Later builds reuse dependency layers. The runtime images contain production dependencies, application code, and assets; host `.env` files, local databases, uploads, caches, and browser-test output are excluded from build contexts.

```sh
docker compose ps
docker compose logs -f
docker compose restart
docker compose down
```

`down` removes these containers and their network, while retaining the named data volume. Running `up` again restores the same data. `docker compose down --volumes` also deletes the database, uploads, and generated signing secret; use it only for an intentional reset.

After pulling source changes, rebuild with the startup command. Startup applies Alembic migrations before serving traffic. Seeding checks for an empty database and preserves existing data.

## Configuration

Defaults work without a configuration file. Copy the root `.env.example` to `.env` for optional overrides; Compose reads it automatically. Existing `backend/.env` and `frontend/.env.local` belong to the local launch workflow and are not used by Docker.

| Variable | Default | Purpose |
| --- | --- | --- |
| `FRONTEND_PORT` | `3000` | Host port for the frontend; container always listens on 3000 |
| `BACKEND_PORT` | `8000` | Host API/WebSocket port; container always listens on 8000 |
| `BIND_ADDRESS` | `127.0.0.1` | Host interface for both published ports |
| `SEED_ON_STARTUP` | `true` | Create demo users/chats/media in an empty database |
| `JWT_SECRET` | Generated and persisted | Optional explicit session-signing secret |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:{BACKEND_PORT}` | Browser-visible WebSocket base URL, without `/ws` |

For example, if another application uses port 3000 or 8000:

```dotenv
FRONTEND_PORT=3010
BACKEND_PORT=8002
```

Rebuild and open http://localhost:3010. The browser WebSocket URL automatically uses the selected backend port unless explicitly overridden. REST/media requests go through the frontend to `http://backend:8000` over the Compose network; `backend` is an internal service hostname and cannot be used as a browser WebSocket hostname.

Next.js compiles the REST rewrite target and `NEXT_PUBLIC_WS_URL` during the image build. Rebuild the frontend when changing the browser WebSocket URL or backend host port. For access from another machine, set `BIND_ADDRESS=0.0.0.0` and a WebSocket URL using the host's reachable address, then rebuild. For HTTPS hosting, use `wss://` through a proxy that supports WebSocket upgrades. Hosting remains outside this local Docker setup.

When `JWT_SECRET` is unset/blank, the backend generates a random value in `/app/data/.jwt-secret` with owner-only permissions and reuses it on later starts. An explicit environment value takes precedence. Keep the same secret to preserve sessions; replacing it invalidates existing tokens. The secret is never baked into an image or printed to logs.

## Persistence and process behavior

The `backend-data` named volume mounts at `/app/data` and holds `signal.db`, uploads, and the generated secret. It is owned by the backend's non-root user. Containers use the same SQLite foreign-key/WAL setup as local execution. The backend runs one worker because live connections and presence are held in memory.

Both services have health checks, bounded logs, restart policies, dropped Linux capabilities, and non-root runtime users. Compose starts the frontend after the backend is healthy. Init processes and an exec entrypoint allow graceful shutdown. The container workflow starts with a separate database; it leaves the local `backend/data` folder untouched.

## Troubleshooting

- **Docker engine unavailable:** start Docker Desktop and select Linux containers, or start the Docker Engine service on Linux.
- **Port already allocated:** stop this project's local services with `scripts/stop.ps1`, stop the owner of the conflicting port, or choose alternate ports in `.env`.
- **Sign-in/API unavailable:** inspect `docker compose ps` and `docker compose logs backend frontend`; the backend must complete migrations and become healthy.
- **Messages fail to update live:** check `NEXT_PUBLIC_WS_URL` points at a browser-reachable host/port, then rebuild. Container names work only inside the Docker network.
- **Fresh database appears unexpectedly:** use the same Compose project name and volume. A different `--project-name` creates a separate volume; `down --volumes` intentionally removes it.

Compose startup behavior follows [Docker's dependency/health-check documentation](https://docs.docker.com/compose/how-tos/startup-order/). Variable overrides follow [Docker's interpolation rules](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).
