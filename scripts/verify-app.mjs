import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = { baseURL: "http://127.0.0.1:3010", writes: false };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--base-url" && args[i + 1]) options.baseURL = args[++i];
  else if (args[i] === "--allow-writes") options.writes = true;
  else if (args[i] === "--reuse-run" && /^\d{13}$/.test(args[i + 1] ?? ""))
    options.reuseRun = args[++i];
  else
    throw new Error(
      "Usage: node scripts/verify-app.mjs [--base-url URL] [--allow-writes] [--reuse-run timestamp]",
    );
}
if (options.reuseRun && !options.writes)
  throw new Error("--reuse-run requires --allow-writes.");
const target = new URL(options.baseURL);
if (
  !["http:", "https:"].includes(target.protocol) ||
  target.username ||
  target.password ||
  target.search ||
  target.hash ||
  target.pathname !== "/"
) {
  throw new Error(
    "Use an HTTP(S) application origin without a path, credentials, or query.",
  );
}
options.baseURL = target.origin;
const run = options.reuseRun ?? Date.now().toString();
const sequence = Date.now().toString().slice(-7);
const output = path.join(
  root,
  ".runtime",
  `app-check-${target.hostname}-${Date.now()}`,
);
fs.mkdirSync(output, { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(
  root,
  ".cache",
  "playwright",
);
const { chromium, expect: baseExpect } = createRequire(
  path.join(root, "frontend", "package.json"),
)("@playwright/test");
const expect = baseExpect.configure({ timeout: 20000 });
const result = {
  baseURL: options.baseURL,
  fixtureRun: run,
  startedAt: new Date().toISOString(),
  writesEnabled: options.writes,
  simulatedDevices: true,
  checks: [],
  errors: [],
  calls: [],
};
const redact = (text) =>
  String(text)
    .replace(/([?&]token=)[^&\s"']+/g, "$1[redacted]")
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[redacted token]",
    );
const browser = await chromium.launch({
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
});
const contexts = await Promise.all(
  [0, 1].map(() =>
    browser.newContext({
      baseURL: options.baseURL,
      permissions: ["microphone", "camera"],
      viewport: { width: 1440, height: 900 },
    }),
  ),
);
const [alice, bob] = await Promise.all(
  contexts.map((context) => context.newPage()),
);
for (const page of [alice, bob]) {
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(90000);
  page.on("pageerror", (error) => result.errors.push(redact(error.message)));
  page.on("websocket", (ws) =>
    ws.on("framereceived", ({ payload }) => {
      try {
        const event = JSON.parse(payload.toString());
        if (event.type === "error")
          result.errors.push(redact(event.data.detail));
      } catch {
        /* Binary/non-JSON frames are not application error events. */
      }
    }),
  );
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    window.__checkSockets = [];
    window.WebSocket = class extends NativeSocket {
      constructor(...args) {
        super(...args);
        window.__checkSockets.push(this);
      }
    };
    const Native = window.RTCPeerConnection;
    window.__checkPeers = [];
    window.RTCPeerConnection = class extends Native {
      constructor(configuration) {
        super(configuration);
        window.__checkPeers.push(this);
      }
    };
    const NativeAudio = window.AudioContext;
    window.__checkSounds = [];
    window.AudioContext = class extends NativeAudio {
      createBufferSource() {
        const source = super.createBufferSource();
        const probe = {
          loop: false,
          started: false,
          stopped: false,
          audible: false,
          running: false,
        };
        window.__checkSounds.push(probe);
        const start = source.start.bind(source),
          stop = source.stop.bind(source);
        source.start = (...args) => {
          Object.assign(probe, {
            loop: source.loop,
            started: true,
            running: this.state === "running",
            audible:
              source.buffer
                ?.getChannelData(0)
                .some((sample) => Math.abs(sample) > 0.01) ?? false,
          });
          return start(...args);
        };
        source.stop = (...args) => {
          probe.stopped = true;
          return stop(...args);
        };
        source.addEventListener("ended", () => {
          probe.stopped = true;
        });
        return source;
      }
    };
  });
}

async function check(name, task) {
  const item = { name, status: "running" };
  result.checks.push(item);
  try {
    await task();
    item.status = "passed";
    console.log(`PASS ${name}`);
  } catch (error) {
    item.status = "failed";
    item.error = redact(error.message);
    throw error;
  }
}
async function api(page, method, endpoint, body) {
  return page.evaluate(
    async ({ method, endpoint, body }) => {
      const token = localStorage.getItem("signal-token");
      const response = await fetch(`/api${endpoint}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok)
        throw new Error(`${method} ${endpoint} returned ${response.status}`);
      return response.status === 204 ? null : response.json();
    },
    { method, endpoint, body },
  );
}
async function register(page, phone, name, username) {
  await page.goto("/signup");
  await page.getByLabel("Phone number", { exact: false }).fill(phone);
  const otpResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/request-otp") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const { dev_code } = await (await otpResponse).json();
  await page.getByLabel("Verification code", { exact: true }).fill(dev_code);
  await page
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  if (!options.reuseRun) {
    await expect(
      page.getByRole("heading", { name: "Your profile", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Your name", { exact: false }).fill(name);
    await page.getByLabel("Username", { exact: false }).fill(username);
    await page
      .getByRole("button", { name: "Start messaging", exact: true })
      .click();
  }
  await expect(page).toHaveURL(/\/chats$/);
  if (!options.reuseRun)
    await expect(page.locator(".conversation-select")).toHaveCount(1);
  const user = await api(page, "GET", "/me");
  expect(user.display_name).toBe(name);
  expect(user.username).toBe(username);
  return user;
}
async function send(page, text) {
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  return page.getByRole("article", { name: `You: ${text}`, exact: true });
}
async function media(page) {
  return page.evaluate(async () => {
    const pc = window.__checkPeers.at(-1);
    if (!pc) return null;
    const stats = await pc.getStats();
    let inboundBytes = 0,
      selectedType = null;
    stats.forEach((stat) => {
      if (stat.type === "inbound-rtp") inboundBytes += stat.bytesReceived ?? 0;
      if (
        stat.type === "candidate-pair" &&
        (stat.selected || stat.nominated) &&
        stat.state === "succeeded"
      )
        selectedType = stats.get(stat.localCandidateId)?.candidateType ?? null;
    });
    const turnURLs = (pc.getConfiguration().iceServers ?? [])
      .flatMap((server) =>
        Array.isArray(server.urls) ? server.urls : [server.urls],
      )
      .filter((url) => /^turns?:/.test(url));
    return {
      connection: pc.connectionState,
      inboundBytes,
      selectedType,
      turnConfigured: turnURLs.length > 0,
    };
  });
}
let storyId;
try {
  await check(
    "Landing, download, authentication routes and API reachability",
    async () => {
      for (const route of ["/", "/download", "/login", "/signup"]) {
        const response = await alice.request.get(route, { timeout: 90000 });
        expect(response.status(), route).toBe(200);
      }
      // Requesting the mocked OTP does not create an account or change user data.
      // /health belongs to the API origin, not the frontend's /api rewrite.
      const response = await alice.request.post("/api/auth/request-otp", {
        data: { phone: "+15550000001" },
        timeout: 90000,
      });
      expect(response.status()).toBe(200);
      expect((await response.json()).phone).toBe("+15550000001");
    },
  );
  await check("Demo profiles and responsive login", async () => {
    await alice.goto("/login");
    await expect(
      alice.getByRole("button", { name: "Alex Rivera", exact: true }),
    ).toBeVisible();
    result.clearDemoHeading = await alice
      .getByRole("heading", { name: "Try a demo account", exact: true })
      .isVisible();
    await alice.screenshot({
      path: path.join(output, "login-desktop.png"),
      fullPage: true,
    });
    await alice.setViewportSize({ width: 320, height: 568 });
    expect(
      await alice.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await alice.screenshot({
      path: path.join(output, "login-mobile.png"),
      fullPage: true,
    });
  });
  if (options.writes) {
    const suffix = run.slice(-7),
      firstName = `Smoke Alice ${suffix}`,
      secondName = `Smoke Bob ${suffix}`;
    let first, second, directId, groupId;
    await check(
      options.reuseRun
        ? "Smoke-account login on mobile and desktop"
        : "Fresh signup on mobile and desktop",
      async () => {
        first = await register(
          alice,
          `+1997${suffix}`,
          firstName,
          `smoke_a_${suffix}`,
        );
        await alice.setViewportSize({ width: 1440, height: 900 });
        second = await register(
          bob,
          `+1998${suffix}`,
          secondName,
          `smoke_b_${suffix}`,
        );
        result.testAccounts = [
          { id: first.id, name: firstName },
          { id: second.id, name: secondName },
        ];
      },
    );
    await check("Contact discovery and a direct conversation", async () => {
      await alice
        .locator(".sidebar-header")
        .getByRole("button", { name: "New conversation", exact: true })
        .click();
      await alice.getByLabel("Find a person").fill(`@smoke_b_${suffix}`);
      await alice
        .getByRole("dialog")
        .getByRole("button", { name: new RegExp(secondName) })
        .click();
      await expect(alice).toHaveURL(/\/chats\/\d+$/);
      directId = Number(new URL(alice.url()).pathname.split("/").at(-1));
      await api(bob, "POST", "/contacts", { user_id: first.id });
      await api(alice, "POST", "/contacts", { user_id: second.id });
    });
    const text = `Smoke message ${sequence}`;
    await check(
      "Live messages, a notification chime and read receipts",
      async () => {
        await bob
          .getByRole("navigation", { name: "Main navigation", exact: true })
          .getByRole("link", { name: "Stories", exact: true })
          .click();
        const outgoing = await send(alice, text);
        await expect
          .poll(() =>
            bob.evaluate(
              () =>
                window.__checkSounds.filter(
                  (sound) =>
                    !sound.loop &&
                    sound.started &&
                    sound.running &&
                    sound.audible,
                ).length,
            ),
          )
          .toBeGreaterThan(0);
        await bob.goto(`/chats/${directId}`);
        await expect(
          bob.getByRole("article", {
            name: `${firstName}: ${text}`,
            exact: true,
          }),
        ).toBeVisible();
        await bob.bringToFront();
        await expect(
          outgoing.getByLabel("read", { exact: true }),
        ).toBeVisible();
        const reply = `Smoke reply ${sequence}`;
        await send(bob, reply);
        await expect(
          alice.getByRole("article", {
            name: `${secondName}: ${reply}`,
            exact: true,
          }),
        ).toBeVisible();
        await alice.reload();
        await expect(
          alice.getByRole("article", {
            name: `${secondName}: ${reply}`,
            exact: true,
          }),
        ).toBeVisible();
      },
    );
    await check(
      "Group creation, live group messages and member details",
      async () => {
        await alice
          .locator(".sidebar-header")
          .getByRole("button", { name: "New conversation", exact: true })
          .click();
        await alice
          .getByRole("button", { name: "New group", exact: true })
          .click();
        const name = `Smoke group ${sequence}`;
        await alice.getByLabel("Group name", { exact: true }).fill(name);
        await alice
          .getByRole("dialog")
          .getByRole("button", { name: new RegExp(secondName) })
          .click();
        await alice
          .getByRole("button", { name: "Create group", exact: true })
          .click();
        await expect(
          alice.getByRole("region", {
            name: `Conversation with ${name}`,
            exact: true,
          }),
        ).toBeVisible();
        groupId = Number(new URL(alice.url()).pathname.split("/").at(-1));
        await bob
          .locator(".conversation-select")
          .filter({ hasText: name })
          .click();
        const groupText = `Group delivery ${sequence}`;
        await send(alice, groupText);
        await expect(
          bob.getByRole("article", {
            name: `${firstName}: ${groupText}`,
            exact: true,
          }),
        ).toBeVisible();
        await alice
          .getByRole("button", { name: "Conversation details", exact: true })
          .click();
        await expect(alice.locator(".group-member")).toHaveCount(2);
        await alice
          .getByRole("button", { name: "Close details", exact: true })
          .click();
      },
    );
    await check("A private Story, its viewer and deletion", async () => {
      await alice.goto("/stories");
      await alice
        .getByRole("button", { name: "Add story", exact: true })
        .click();
      await alice
        .getByLabel("Story text", { exact: true })
        .fill(`Smoke story ${sequence}`);
      await alice.getByLabel("Find people", { exact: true }).fill(secondName);
      await alice
        .getByRole("dialog", { name: "Create story", exact: true })
        .getByRole("button", { name: new RegExp(secondName) })
        .click();
      const created = alice.waitForResponse(
        (response) =>
          response.url().endsWith("/api/stories") &&
          response.request().method() === "POST" &&
          response.ok(),
      );
      await alice
        .getByRole("button", { name: "Share story", exact: true })
        .click();
      storyId = (await (await created).json()).id;
      await bob.goto("/stories");
      await bob
        .getByRole("button", { name: `View ${firstName}'s story`, exact: true })
        .click();
      await expect(
        bob.getByRole("dialog", { name: `Story by ${firstName}`, exact: true }),
      ).toContainText(`Smoke story ${sequence}`);
      await expect
        .poll(async () =>
          (await api(alice, "GET", `/stories/${storyId}/views`)).some(
            (view) => view.user.id === second.id,
          ),
        )
        .toBe(true);
      await api(alice, "DELETE", `/stories/${storyId}`);
      storyId = undefined;
    });
    await check("Voice/video ringing, actual media and hang-up", async () => {
      await alice.goto(`/chats/${directId}`);
      await bob.goto("/stories");
      await bob
        .getByRole("heading", { name: "Stories", exact: true, level: 1 })
        .click();
      for (const page of [alice, bob])
        await expect
          .poll(() =>
            page.evaluate(() =>
              window.__checkSockets.some(
                (ws) =>
                  ws.url.includes("/ws?") && ws.readyState === WebSocket.OPEN,
              ),
            ),
          )
          .toBe(true);
      for (const kind of ["voice", "video"]) {
        await alice
          .getByRole("button", {
            name: kind === "voice" ? "Voice call" : "Video call",
            exact: true,
          })
          .click();
        await expect(
          bob.getByRole("button", { name: "Accept call", exact: true }),
        ).toBeVisible();
        for (const page of [alice, bob])
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  window.__checkSounds.filter(
                    (sound) =>
                      sound.loop &&
                      sound.started &&
                      !sound.stopped &&
                      sound.running &&
                      sound.audible,
                  ).length,
              ),
            )
            .toBeGreaterThan(0);
        await bob
          .getByRole("button", { name: "Accept call", exact: true })
          .click();
        for (const page of [alice, bob]) {
          await expect(
            page.getByLabel("Call status", { exact: true }),
          ).toHaveAttribute("data-phase", "connected", { timeout: 45000 });
          await expect
            .poll(async () => (await media(page))?.inboundBytes ?? 0, {
              timeout: 20000,
            })
            .toBeGreaterThan(0);
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  window.__checkSounds.filter(
                    (sound) => sound.loop && sound.started && !sound.stopped,
                  ).length,
              ),
            )
            .toBe(0);
          if (kind === "video")
            await expect
              .poll(() =>
                page
                  .getByLabel("Remote video", { exact: true })
                  .evaluate((video) => video.videoWidth),
              )
              .toBeGreaterThan(0);
        }
        result.calls.push({
          kind,
          caller: await media(alice),
          recipient: await media(bob),
        });
        await bob.screenshot({
          path: path.join(output, `${kind}-connected.png`),
        });
        await alice
          .getByRole("button", { name: "Hang up", exact: true })
          .click();
        await expect(bob.locator(".call-window")).toHaveCount(0);
      }
    });
    await check("Mobile conversation and settings", async () => {
      await alice.setViewportSize({ width: 390, height: 844 });
      expect(
        await alice.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await alice.screenshot({
        path: path.join(output, "chat-mobile.png"),
        fullPage: true,
      });
      await alice.setViewportSize({ width: 1440, height: 900 });
      await alice
        .getByRole("navigation", { name: "Main navigation", exact: true })
        .getByRole("button", { name: "Settings", exact: true })
        .click();
      await expect(
        alice.getByRole("dialog", { name: "Settings", exact: true }),
      ).toBeVisible();
      await alice
        .getByRole("dialog", { name: "Settings", exact: true })
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
    });
  }
  expect(result.errors).toEqual([]);
  result.success = true;
} catch (error) {
  result.success = false;
  result.failure = redact(error.message);
  await alice
    .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  if (storyId)
    await api(alice, "DELETE", `/stories/${storyId}`).catch(() => {});
  for (const page of [alice, bob]) {
    const hangup = page.getByRole("button", { name: "Hang up", exact: true });
    if (await hangup.isVisible().catch(() => false))
      await hangup.click().catch(() => {});
  }
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(output, "results.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  await browser.close();
}
console.log(JSON.stringify(result, null, 2));
console.log(`Evidence: ${path.relative(root, output)}`);
