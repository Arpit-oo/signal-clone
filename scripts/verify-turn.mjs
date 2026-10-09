import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Exercise the running application, its authenticated signaling and actual RTP.
// Forcing relay in these isolated browsers prevents a same-machine direct call
// from passing this check when the TURN server is unavailable.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = { baseURL: "http://127.0.0.1:3000", transport: "udp" };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--base-url" && args[i + 1]) options.baseURL = args[++i];
  else if (args[i] === "--transport" && args[i + 1]) options.transport = args[++i];
  else throw new Error("Usage: node scripts/verify-turn.mjs [--base-url URL] [--transport udp|tcp]");
}
if (!["udp", "tcp"].includes(options.transport)) throw new Error("Transport must be udp or tcp.");
const url = new URL(options.baseURL);
if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
  throw new Error("Use the application's HTTP(S) base URL without credentials or query parameters.");
}
const output = path.join(root, ".runtime", `turn-check-${options.transport}`);
fs.mkdirSync(output, { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(root, ".cache", "playwright");
const { chromium, expect } = createRequire(path.join(root, "frontend", "package.json"))("@playwright/test");
const result = { baseURL: options.baseURL, transport: options.transport, simulatedDevices: true, calls: [], errors: [] };
const redact = (text) => String(text).replace(/([?&]token=)[^&\s"']+/g, "$1[redacted]");

async function inspect(page) {
  page.on("pageerror", (error) => result.errors.push(redact(error.message)));
  await page.addInitScript(({ transport }) => {
    const Native = window.RTCPeerConnection;
    const peers = [];
    const diagnostics = [];
    Object.assign(window, { __turnCheckPeers: peers, __turnCheckDiagnostics: diagnostics });
    window.RTCPeerConnection = class extends Native {
      constructor(configuration) {
        const iceServers = (configuration?.iceServers ?? []).flatMap((server) => {
          const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter((url) =>
            /^turns?:/.test(url) && (url.includes(`transport=${transport}`) || (!url.includes("transport=") && transport === "udp")),
          );
          return urls.length ? [{ ...server, urls }] : [];
        });
        if (!iceServers.length) throw new Error(`No TURN ${transport} server in this frontend build. Configure ICE servers and rebuild first.`);
        super({ ...configuration, iceServers, iceTransportPolicy: "relay" });
        peers.push(this);
        this.addEventListener("icecandidate", ({ candidate }) => {
          if (candidate) diagnostics.push({ candidateType: candidate.type, protocol: candidate.protocol, address: candidate.address, port: candidate.port });
        });
        this.addEventListener("icecandidateerror", (event) => diagnostics.push({ errorCode: event.errorCode, url: event.url }));
        this.addEventListener("iceconnectionstatechange", () => diagnostics.push({ ice: this.iceConnectionState }));
      }
    };
  }, { transport: options.transport });
}

async function login(page, name) {
  await page.goto("/login", { timeout: 90000 });
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
  await expect(page.locator(".conversation-select").first()).toBeVisible({ timeout: 90000 });
}

async function stats(page) {
  return page.evaluate(async () => {
    const pc = window.__turnCheckPeers.at(-1);
    if (!pc) return { peers: 0 };
    const reports = await pc.getStats();
    let inboundBytes = 0;
    let selectedPair;
    reports.forEach((report) => {
      if (report.type === "inbound-rtp") inboundBytes += Number(report.bytesReceived ?? 0);
      if (report.type === "transport" && report.selectedCandidatePairId) selectedPair = reports.get(report.selectedCandidatePairId);
    });
    const local = reports.get(selectedPair?.localCandidateId);
    const remote = reports.get(selectedPair?.remoteCandidateId);
    return {
      connection: pc.connectionState,
      ice: pc.iceConnectionState,
      policy: pc.getConfiguration().iceTransportPolicy,
      inboundBytes,
      selectedLocalType: local?.candidateType,
      selectedRemoteType: remote?.candidateType,
      relayProtocol: local?.relayProtocol,
      diagnostics: window.__turnCheckDiagnostics,
    };
  });
}

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const contexts = await Promise.all([0, 1].map(() => browser.newContext({
  baseURL: options.baseURL,
  permissions: ["microphone", "camera"],
  viewport: { width: 1440, height: 900 },
})));
const [caller, recipient] = await Promise.all(contexts.map((context) => context.newPage()));
try {
  await inspect(caller);
  await inspect(recipient);
  await login(caller, "Alex Rivera");
  await login(recipient, "Priya Sharma");
  await caller.locator(".conversation-select").filter({ hasText: "Priya Sharma" }).click();
  await expect(caller.getByLabel("Message", { exact: true })).toBeVisible();
  await recipient.getByRole("link", { name: "Stories", exact: true }).click();
  for (const kind of ["voice", "video"]) {
    await caller.getByRole("button", { name: kind === "video" ? "Video call" : "Voice call", exact: true }).click();
    await expect(recipient.getByRole("button", { name: "Accept call", exact: true })).toBeVisible({ timeout: 25000 });
    await recipient.getByRole("button", { name: "Accept call", exact: true }).click();
    for (const page of [caller, recipient]) {
      await expect(page.getByLabel("Call status", { exact: true })).toHaveAttribute("data-phase", "connected", { timeout: 45000 });
      await expect.poll(async () => (await stats(page)).inboundBytes, { timeout: 15000 }).toBeGreaterThan(0);
      const media = await stats(page);
      expect(media.policy).toBe("relay");
      expect(media.selectedLocalType).toBe("relay");
      expect(media.relayProtocol).toBe(options.transport);
      if (kind === "video") {
        await expect.poll(() => page.locator('video[aria-label="Remote video"]').evaluate((video) => video.videoWidth), { timeout: 15000 }).toBeGreaterThan(0);
      }
    }
    result.calls.push({ kind, caller: await stats(caller), recipient: await stats(recipient) });
    await recipient.screenshot({ path: path.join(output, `${kind}-connected.png`), animations: "disabled" });
    await caller.getByRole("button", { name: "Hang up", exact: true }).click();
    await expect(recipient.locator(".call-window")).toHaveCount(0);
  }
  expect(result.errors).toEqual([]);
  result.success = true;
} catch (error) {
  result.success = false;
  result.failure = redact(error.message);
  result.lastCaller = await stats(caller).catch(() => null);
  result.lastRecipient = await stats(recipient).catch(() => null);
  await caller.screenshot({ path: path.join(output, "caller-failure.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  for (const page of [caller, recipient]) {
    const hangup = page.getByRole("button", { name: "Hang up", exact: true });
    if (await hangup.isVisible().catch(() => false)) await hangup.click().catch(() => {});
  }
  fs.writeFileSync(path.join(output, "results.json"), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}
console.log(JSON.stringify(result, null, 2));
console.log(`Evidence: ${path.relative(root, output)} (no tokens or TURN credentials included).`);
