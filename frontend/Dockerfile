# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM base AS builder
ARG API_ORIGIN=http://backend:8000
ARG NEXT_PUBLIC_WS_URL=ws://localhost:8000
ARG NEXT_PUBLIC_RTC_ICE_SERVERS=[]
ENV NODE_ENV=production \
    NEXT_STANDALONE=true \
    NEXT_DIST_DIR=.next \
    API_ORIGIN=${API_ORIGIN} \
    NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL} \
    NEXT_PUBLIC_RTC_ICE_SERVERS=${NEXT_PUBLIC_RTC_ICE_SERVERS}
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
LABEL org.opencontainers.image.title="Signal Clone frontend" \
      org.opencontainers.image.description="Standalone Next.js messenger frontend"
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "server.js"]
