# Deployment

The backend runs on Render and the Next.js frontend runs on Vercel. Deploy the backend first so its public URL is available to the frontend.

## Render

1. Open [Render New Blueprint](https://dashboard.render.com/select-repo?type=blueprint).
2. Select `Arpit-oo/Signal-Clone-Scalar` and use the repository `render.yaml`.
3. The blueprint creates `signal-clone-scalar-api` from `backend/`.
4. In the service environment, set `CORS_ORIGINS` to the final Vercel URL, for example `https://signal-clone-scalar.vercel.app`.
5. Keep the generated `JWT_SECRET`, `SEED_ON_STARTUP=true`, and `AUTO_MIGRATE_ON_STARTUP=true` values.
6. Deploy and verify `https://<render-service>.onrender.com/health` returns `{"status":"ok"}`.

The free Render service uses ephemeral local SQLite storage and uploaded files. It reseeds demo data when the database is empty. Use a persistent disk or external database/storage for production data.

### Keep accounts, messages, and uploads across restarts

Render's free service cannot attach a persistent disk. The optional
[`render.persistent.yaml`](render.persistent.yaml) blueprint prepares the same
single-worker API on the paid Starter plan with a 1 GB disk at `/var/data`.
It stores SQLite at `/var/data/signal.db` and uploads at `/var/data/uploads`.
The existing `render.yaml` remains the free demo configuration; the optional
file does not provision or upgrade a service.

For a new disk-backed service, select `render.persistent.yaml` as the Blueprint
path, review the paid plan, and set `CORS_ORIGINS`. Startup creates directories,
applies migrations, and seeds only an empty database. Keep one instance and one
backend worker.

For an existing service, preserve an online SQLite backup, uploads, and the
existing `JWT_SECRET` before a restart/redeploy can discard ephemeral data.
Attach the disk, restore the database and uploads, then set:

```text
DATABASE_URL=sqlite+aiosqlite:////var/data/signal.db
UPLOAD_DIR=/var/data/uploads
```

An empty disk does not automatically migrate existing data. Create a test
account and upload, restart the disk-backed service, and verify both survive.
Keep regular SQLite online backups and uploads backups. See
[Render's persistent disk documentation](https://render.com/docs/disks).

## Vercel

1. Open [Vercel New Project](https://vercel.com/new) and import `Arpit-oo/Signal-Clone-Scalar`.
2. Set **Root Directory** to `frontend`.
3. Use the Next.js framework preset and the detected `npm run build` command.
4. Add these environment variables for Production (and Preview if needed):

   - `API_ORIGIN=https://<render-service>.onrender.com`
   - `NEXT_PUBLIC_WS_URL=wss://<render-service>.onrender.com`
   - `NEXT_PUBLIC_RTC_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"stun:stun1.l.google.com:19302"}]`

5. Deploy the project and copy its public URL.
6. Return to Render and set `CORS_ORIGINS` to that exact Vercel origin without a trailing slash, then redeploy the API.

The Next.js server proxies REST and media requests through `API_ORIGIN`. The browser connects directly to the backend WebSocket using `NEXT_PUBLIC_WS_URL`, so both values must point to the same Render service. The frontend falls back to Google STUN when the ICE variable is absent or empty; use the optional TURN setup for restrictive networks.

## Calling and sounds

Ringing/signaling and the audio/video connection are separate. Call ringtones and message chimes are generated in the browser and unlock after a user click/key interaction; Settings > Notifications includes sound controls and a preview. If an incoming call arrives before audio is enabled, use **Enable call sound**. A muted tab or system output can still silence playback.

For callers on networks that cannot establish a direct media path, configure a public TURN provider or VPS using [the relay guide](turn/README.md). The browser build's `NEXT_PUBLIC_RTC_ICE_SERVERS` must include authenticated TURN URLs; STUN alone does not guarantee media connectivity. For example (replace every placeholder):

```json
[
  { "urls": "stun:stun.l.google.com:19302" },
  {
    "urls": ["turn:TURN_HOST:3478?transport=udp", "turns:TURN_HOST:5349?transport=tcp"],
    "username": "TURN_USERNAME",
    "credential": "TURN_PASSWORD"
  }
]
```

Use only listeners actually provided by your TURN service: `turns:` requires a valid TLS certificate and TLS listener. The local Coturn example supplies plain TURN/3478, not TLS/5349. Rebuild the frontend after changing this setting. Browser-facing credentials are visible in the bundle; use short-lived credentials issued by an authenticated backend/provider for a public service. The provided local relay uses a reusable assessment credential. The web API handles signaling; the TURN provider/VPS handles relay traffic. [Forced-relay browser checks](turn/README.md#verify-actual-relayed-media) verify actual voice/video transport.

## Demo login

Use any seeded demo account with OTP `123456`. Alex Rivera is `+15550000001`; Priya Sharma is `+919876540102`.

## A free public call relay

[Metered Open Relay](https://www.metered.ca/tools/openrelay/) offers a free TURN
allowance and requires an account. Create the account, obtain its authenticated
ICE server array from the dashboard/API, and set that JSON as
`NEXT_PUBLIC_RTC_ICE_SERVERS` in Vercel's Production environment. Include only
the UDP, TCP, and TLS endpoints offered by the provider, then rebuild the
frontend from the deployment repository. Account API keys remain private; only
browser-facing ICE credentials belong in this setting. Keep credentials out of
Git. A hosted app cannot use this computer's private LAN relay.

After release, run `scripts/verify-turn.mjs` against the hosted URL to verify
actual relayed voice/video. Then call between physical devices on different
Wi-Fi/mobile networks. A direct call on one machine does not prove the public
relay is configured. No public relay account is bundled with this repository.

## Browser smoke check

Install frontend dependencies and Chromium (`scripts/setup.ps1 -BrowserTests`
on Windows), then run the read-only check:

```sh
node scripts/verify-app.mjs --base-url https://signal-clone-scalar.vercel.app
```

This checks landing/download/login/signup routes, API reachability through a
mock-OTP request that does not change user data, and desktop/mobile login layout.
For a deployment you own, explicitly enable signup and messaging checks:

```sh
node scripts/verify-app.mjs --base-url https://signal-clone-scalar.vercel.app --allow-writes
```

The full check creates two clearly named `Smoke Alice`/`Smoke Bob` accounts and
their private conversations. It checks mobile/desktop signup, contact discovery,
live direct/group messages, read receipts, chimes, Story publishing/views/deletion,
voice/video ringing/media/hang-up, and mobile/settings layout. It sends no
messages or Stories to other accounts. Test accounts and history remain for
inspection; its Story is deleted and calls are ended. To retry with the same
accounts, add `--reuse-run <fixtureRun>` from the report.

Screenshots and reports go under ignored `.runtime/app-check-*`. Reports omit
authentication tokens and TURN credentials. Microphone/camera are simulated;
this checks real browser media but not physical speakers or different networks.
Use `verify-turn.mjs` for forced relay checks.
