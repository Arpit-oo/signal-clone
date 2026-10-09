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
