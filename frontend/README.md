# Signal Clone frontend

Next.js App Router, React, TypeScript, Tailwind CSS, and Zustand provide the messaging UI. The root [README](../README.md) covers the complete app and Windows launch scripts.

## Run separately

```powershell
npm ci --cache ../.cache/npm
Copy-Item .env.example .env.local
npm run dev
```

Start the FastAPI backend on port 8000, then open http://127.0.0.1:3000 for the reference homepage, `/download` for the local demo entry and official downloads, or `/chats` for messaging. Demo verification uses code `123456`; Alex's phone is `+15550000001`, Priya's is `+15550000002`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_ORIGIN` | `http://127.0.0.1:8000` | Server-side REST/media proxy |
| `NEXT_PUBLIC_WS_URL` | Browser hostname on port 8000 | Browser WebSocket base, without `/ws` |
| `NEXT_DIST_DIR` | `.next` | Build output; browser tests use `.next-e2e` |

Browser variables are bundled into production builds. Rebuild after changing the WebSocket hostname. Protected media URLs include the current session token; profile avatars are public on the local API.

## Code

- `src/app/`: homepage/download/login/messaging pages, root layout, design tokens.
- `src/components/site/`, `public/signal/`: responsive website navigation/footer and local reference assets.
- `src/components/`: app/sidebar, contacts/groups, settings/profile, dialogs, and icons.
- `src/components/chat/`: timeline, composer, message actions, media, voice notes, search, and scoped styles.
- `src/stores/`: session, persisted preferences, messages/outbox, receipts and events.
- `src/lib/`: typed API client, server contracts, reconnecting WebSocket client.

The provider restores sessions, applies appearance, subscribes to events, refreshes missed state on reconnect, and delivers permitted background notifications. Login outages preserve saved tokens. Failed uploads stay retryable in the open tab; outbox and drafts are memory-resident and are cleared on full reload/sign-out.

## Check

```powershell
npm run lint
npm run typecheck
npm test
npm run build
$env:PLAYWRIGHT_BROWSERS_PATH = (Join-Path (Split-Path (Get-Location)) '.cache/playwright')
npx playwright install chromium
npm run test:e2e
```

Playwright starts isolated FastAPI/Next servers on 8001/3001 and uses project-local browsers and data. It needs installed `backend/.venv` dependencies. Reports/screenshots are written to `test-results/` on failure. Production startup is `npm run start` after `npm run build`.

This local Signal-inspired project has mock authentication and server-stored messages; it does not implement Signal encryption, device linking, or live calls.
