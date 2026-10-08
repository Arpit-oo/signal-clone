# Signal Clone frontend

Next.js App Router, React, TypeScript, Tailwind CSS, and Zustand provide the messaging UI. The root [README](../README.md) covers the complete app and Windows launch scripts.

For the container workflow, see [DOCKER.md](../DOCKER.md). The multi-stage image sets `NEXT_STANDALONE=true`, copies the minimal server/static/public output, and runs as the non-root `node` user. Normal local builds retain their existing output.

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

- `src/app/`: homepage/download/login/signup/messaging/Stories pages, root layout, design tokens.
- `src/components/site/`, `public/signal/`: responsive website navigation/footer and local reference assets.
- `src/components/AppShell.tsx`, `src/components/shell/`: screen composition, navigation, conversation list/search, menus, and shell dialogs.
- `src/hooks/shell/`: route resolution, stale-search cancellation, list derivation, menu focus, and conversation actions.
- `src/components/`: contacts/groups, settings/profile, dialogs, and icons.
- `src/components/chat/`: chat header, timeline, composer, message actions, media, voice notes, search, and styles. `useTimelineScroll` owns history loading and scroll preservation; `useConversationActions` owns mutations and composer/dialog state.
- `src/app/styles/`: shared controls, shell layout, conversations, search, details, settings, auth, and responsive CSS. `shell.css` imports these in cascade order with responsive rules last.
- `src/stores/`: session, persisted preferences, messages/outbox, receipts and events.
- `src/lib/`: typed API client, server contracts, reconnecting WebSocket client.

The provider restores sessions, applies appearance, subscribes to events, refreshes missed state on reconnect, and delivers permitted background notifications. Login outages preserve saved tokens. Failed uploads stay retryable in the open tab; outbox and drafts are memory-resident and are cleared on full reload/sign-out.

Stories uses the same session and WebSocket connection. Its feed refreshes on story changes and reconnect; the portrait viewer supports pause/resume and previous/next navigation. Creation requires an explicit audience and sends text or selected media to the backend. Story view/delete operations and media authorization use the REST API. `/stories` is a protected return destination through sign-in and profile setup.

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
