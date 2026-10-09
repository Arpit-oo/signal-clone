# TURN relay for calling

WebSocket signaling can ring a phone successfully while WebRTC cannot establish a media path between the browsers. STUN discovers addresses; TURN relays media when direct connections fail. This optional, authenticated Coturn container supplies UDP and TCP TURN on port 3478. It is separate from the application containers and does not touch SQLite or uploads.

Requires Node.js 22.12+, Docker with Linux containers, and Compose v2. Run commands from the repository root. Nothing here publishes or deploys the application.

## Local setup

```sh
node scripts/setup-turn.mjs --configure-app
docker compose -f turn/compose.yaml up -d --wait
```

The setup script generates a random 256-bit credential and retains it on subsequent runs. It writes ignored `turn/.runtime/turnserver.conf`, `settings.json`, and `frontend.env`; it prints no credentials. `--configure-app` updates only `NEXT_PUBLIC_RTC_ICE_SERVERS` in the root `.env` and `frontend/.env.local`, preserving ports, API URLs, signing secrets, and other settings. Omit that flag to prepare configuration without changing the app settings.

The script chooses the outbound IPv4 by default. If a VPN or virtual adapter selects an address inaccessible to Docker/the browsers, supply your actual LAN IPv4 explicitly:

```sh
node scripts/setup-turn.mjs --public-ip 192.168.1.20 --configure-app
docker compose -f turn/compose.yaml restart relay
```

Use your own address in place of the example. Keep the same IP while testing, and allow TCP/UDP 3478 and UDP 49160-49200 through the local firewall. The relay publishes these ports on the host's interfaces so Docker can send traffic to its advertised relay address. Application ports retain their existing bind settings. Do not use `127.0.0.1` as the advertised relay IP: inside the relay container it points to that container.

Rebuild the frontend because Next.js bundles browser ICE settings during the build. For the Docker app:

```sh
docker compose build frontend
docker compose up -d --no-build --wait
```

For the Windows local launcher, stop its owned services and restart with a production build:

```powershell
.\scripts\stop.ps1
.\scripts\start.ps1 -Production -FrontendPort 3010
```

## Verify actual relayed media

Install frontend dependencies and Chromium (`scripts/setup.ps1 -BrowserTests` on Windows), then run against your running application:

```sh
node scripts/verify-turn.mjs --base-url http://127.0.0.1:3010 --transport udp
node scripts/verify-turn.mjs --base-url http://127.0.0.1:3010 --transport tcp
```

Use port 3000 for the default Docker app. The check signs into Alex and Priya in two isolated browser contexts, places voice and video calls, and requires received RTP bytes in both directions, a selected relay candidate, the requested relay transport, and decoded remote video. It forces `iceTransportPolicy: "relay"` only in those test browsers. A direct connection cannot satisfy the check, and the app's normal connection policy is unchanged. The test uses simulated microphone/camera devices; physical-device permissions and calls between separate internet connections still require a manual check.

Screenshots and results go into ignored `.runtime/turn-check-udp/` and `.runtime/turn-check-tcp/`. Reports contain no session tokens or TURN credentials. The test requires the two seeded accounts and their direct conversation; it does not create accounts or messages. A healthy container alone checks STUN responsiveness, not authenticated relay media; use the browser check for that.

Local validation on **2026-10-09** passed all eight combinations: voice/video over UDP/TCP TURN against both the native production app (3010) and Docker production app (3011). Both browsers received media with selected relay candidates; remote video decoded successfully. The relay ran in Docker Desktop on Windows. These checks validate the local configuration; public-host reachability remains pending until a public relay is available.

## Prepare a public relay later

A hosted application needs an internet-reachable relay. This machine's private LAN address cannot serve users on other networks. Use a Linux host/VPS that supports TCP/UDP listeners, or a managed TURN provider; a frontend/serverless deployment is not a TURN host.

On a public Docker host with a stable IPv4 and optional DNS record:

```sh
node scripts/setup-turn.mjs --public-ip 203.0.113.10 --host turn.example.com
docker compose -f turn/compose.yaml up -d --wait
```

Replace the documentation-only IP/hostname with real values. Point DNS at the same IPv4 and permit inbound **TCP/UDP 3478** and **UDP 49160-49200** in the host/cloud firewall. If the host is behind NAT, forward the relay range without changing port numbers. The generated configuration advertises this IPv4 in relay candidates. Run setup on the relay host; supply its generated `NEXT_PUBLIC_RTC_ICE_SERVERS` value from `turn/.runtime/frontend.env` as the frontend's build setting, and rebuild/release the frontend only when deployment is authorized. Keep the generated credential files outside Git.

The supplied container authenticates allocations, limits concurrent allocations/bandwidth, blocks multicast/loopback peers and link-local metadata addresses, and runs as the official image's unprivileged user. It has a read-only filesystem, bounded logs, and only the capability needed by the official binary. UDP relay endpoints serve both UDP and TCP client connections; disabling TCP relay endpoints does not disable TCP TURN clients.

This small assessment setup uses a reusable TURN credential bundled into the browser. Browser users can inspect it. For a broadly exposed service, issue short-lived credentials through an authenticated backend using Coturn's REST authentication mechanism, or use a provider that does so. On a public relay, deny private-network peer destinations as appropriate to its network. For networks that permit only TLS/443, add a trusted certificate and a `turns:...:443?transport=tcp` listener, or use a managed provider with that endpoint. This configuration currently supplies plain TURN/3478; TLS/443 is not configured or verified.

## Operations and troubleshooting

```sh
docker compose -f turn/compose.yaml ps
docker compose -f turn/compose.yaml logs --tail 100 relay
docker compose -f turn/compose.yaml restart relay
docker compose -f turn/compose.yaml down
```

Stopping the relay leaves its credential/configuration files and all app data intact. To undo the frontend configuration, restore the STUN-only setting from `frontend/.env.example` in each app environment file and rebuild. To rotate the relay credential, remove only `turn/.runtime/settings.json`, rerun setup with the same host/IP, restart the relay, update app build settings, and rebuild; existing calls will end during rotation.

- **Rings, then connecting times out:** verify the frontend was rebuilt with TURN, the advertised IPv4 is reachable, and every relay UDP port is forwarded/open. Run both forced-relay checks.
- **No relay candidates:** verify username/credential match the running configuration and port 3478 is accessible. Restart Coturn after changing its static user/configuration.
- **Relay candidates appear, but no media:** check the advertised IP, firewall/NAT mapping for UDP 49160-49200, VPN routing, and Docker Desktop's port forwarding. A TCP TURN client still requires reachable UDP relay endpoints on the server.
- **STUN works but the browser check fails:** the health check cannot prove authentication or peer-to-peer relay forwarding. Read the browser results and Coturn logs.
- **Port in use:** choose a host without another TURN service; these documented ports are fixed in the Compose/configuration pair.

Primary references: [WebRTC TURN setup](https://webrtc.org/getting-started/turn-server), [official Coturn Docker image](https://github.com/coturn/coturn/blob/master/docker/coturn/README.md), and [Coturn configuration](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf).
