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

## Demo login

Use any seeded demo account with OTP `123456`. Alex Rivera is `+15550000001`; Priya Sharma is `+919876540102`.
