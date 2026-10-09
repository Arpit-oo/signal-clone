import { expect, test, type Page } from "@playwright/test";

interface SoundProbe {
  source: AudioBufferSourceNode;
  started: boolean;
  stopped: boolean;
  running: boolean;
  peak: number;
}
declare global {
  interface Window {
    __soundProbe: SoundProbe[];
    __blockSoundResume: boolean;
  }
}

test.use({
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  },
});

async function inspectAudio(page: Page, blocked = false) {
  await page.addInitScript((blocked) => {
    const Native = window.AudioContext;
    window.__soundProbe = [];
    window.__blockSoundResume = blocked;
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super(options);
        if (blocked) void this.suspend();
      }
      resume() {
        if (window.__blockSoundResume)
          return Promise.reject(
            new DOMException("Autoplay blocked", "NotAllowedError"),
          );
        return super.resume();
      }
      createBufferSource() {
        const source = super.createBufferSource();
        const analyser = this.createAnalyser();
        const silence = this.createGain();
        silence.gain.value = 0;
        source.connect(analyser);
        analyser.connect(silence);
        silence.connect(this.destination);
        const probe: SoundProbe = {
          source,
          started: false,
          stopped: false,
          running: false,
          peak: 0,
        };
        window.__soundProbe.push(probe);
        const data = new Float32Array(analyser.fftSize);
        const measure = () => {
          analyser.getFloatTimeDomainData(data);
          probe.peak = Math.max(probe.peak, ...data.map(Math.abs));
        };
        const interval = setInterval(measure, 16);
        source.addEventListener("ended", () => {
          probe.stopped = true;
          clearInterval(interval);
        });
        const start = source.start.bind(source);
        source.start = (...args) => {
          probe.started = true;
          probe.running = this.state === "running";
          start(...args);
        };
        const stop = source.stop.bind(source);
        source.stop = (...args) => {
          probe.stopped = true;
          stop(...args);
        };
        return source;
      }
    };
  }, blocked);
}

async function audio(page: Page) {
  return page.evaluate(() =>
    window.__soundProbe.map((probe) => ({
      started: probe.started,
      stopped: probe.stopped,
      running: probe.running,
      loop: probe.source.loop,
      peak: probe.peak,
      bufferAudible: probe.source.buffer
        ?.getChannelData(0)
        .some((sample) => Math.abs(sample) > 0.01),
    })),
  );
}
async function ringing(page: Page) {
  return (await audio(page)).filter(
    (source) => source.loop && source.started && !source.stopped,
  ).length;
}
async function chimes(page: Page) {
  return (await audio(page)).filter(
    (source) =>
      !source.loop && source.started && source.running && source.bufferAudible,
  ).length;
}
async function login(page: Page, name: string) {
  await page.goto("/login");
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  await expect(page.locator(".conversation-select").first()).toBeVisible();
}
async function settings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
}
async function closeSettings(page: Page) {
  await page
    .getByRole("dialog", { name: "Settings", exact: true })
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
}

test("incoming ringtone and outgoing ringback render audio and stop on acceptance and hangup", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3001",
    permissions: ["microphone"],
  });
  const peer = await context.newPage();
  const errors: string[] = [];
  for (const tab of [page, peer]) {
    tab.on("pageerror", (error) => errors.push(error.message));
    await inspectAudio(tab);
  }
  try {
    await login(page, "Alex Rivera");
    await login(peer, "Priya Sharma");
    await page
      .locator(".conversation-select")
      .filter({ hasText: "Priya Sharma" })
      .click();
    await peer.getByRole("link", { name: "Stories", exact: true }).click();
    await page.getByRole("button", { name: "Voice call", exact: true }).click();
    await expect(
      peer.getByRole("button", { name: "Accept call", exact: true }),
    ).toBeVisible();
    for (const tab of [page, peer]) {
      await expect.poll(() => ringing(tab)).toBe(1);
      await expect
        .poll(async () =>
          Math.max(...(await audio(tab)).map((source) => source.peak)),
        )
        .toBeGreaterThan(0.01);
    }
    await peer
      .getByRole("button", { name: "Accept call", exact: true })
      .click();
    await expect.poll(() => ringing(page)).toBe(0);
    await expect.poll(() => ringing(peer)).toBe(0);
    await expect(
      peer.getByLabel("Call status", { exact: true }),
    ).toHaveAttribute("data-phase", "connected");
    await page.getByRole("button", { name: "Hang up", exact: true }).click();
    await expect(peer.locator(".call-window")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("blocked autoplay offers a working enable-sound action and decline stops both tones", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3001",
    permissions: ["microphone"],
  });
  const peer = await context.newPage();
  await inspectAudio(page);
  await inspectAudio(peer, true);
  try {
    await login(page, "Alex Rivera");
    await login(peer, "Priya Sharma");
    await page
      .locator(".conversation-select")
      .filter({ hasText: "Priya Sharma" })
      .click();
    await page.getByRole("button", { name: "Voice call", exact: true }).click();
    await expect(
      peer.getByRole("button", { name: "Enable call sound", exact: true }),
    ).toBeVisible();
    expect(await ringing(peer)).toBe(0);
    await peer.evaluate(() => {
      window.__blockSoundResume = false;
    });
    await peer
      .getByRole("button", { name: "Enable call sound", exact: true })
      .click();
    await expect.poll(() => ringing(peer)).toBe(1);
    await expect
      .poll(async () =>
        Math.max(...(await audio(peer)).map((source) => source.peak)),
      )
      .toBeGreaterThan(0.01);
    await peer
      .getByRole("button", { name: "Decline call", exact: true })
      .click();
    await expect(page.locator(".call-window")).toHaveCount(0);
    await expect.poll(() => ringing(peer)).toBe(0);
    await expect.poll(() => ringing(page)).toBe(0);
  } finally {
    await context.close();
  }
});

test("call ringtone preference persists and works independently of message sounds", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3001",
  });
  const peer = await context.newPage();
  await inspectAudio(page);
  await inspectAudio(peer);
  try {
    await login(page, "Alex Rivera");
    await login(peer, "Priya Sharma");
    await page
      .locator(".conversation-select")
      .filter({ hasText: "Priya Sharma" })
      .click();
    await settings(peer);
    await peer.getByRole("switch", { name: /^Call ringtone/ }).uncheck();
    await closeSettings(peer);
    await peer.reload();
    await expect(peer.locator(".conversation-select").first()).toBeVisible();
    await page.getByRole("button", { name: "Voice call", exact: true }).click();
    await expect(
      peer.getByRole("button", { name: "Decline call", exact: true }),
    ).toBeVisible();
    expect(await ringing(peer)).toBe(0);
    await peer
      .getByRole("button", { name: "Decline call", exact: true })
      .click();
    await expect(page.locator(".call-window")).toHaveCount(0);
    await settings(peer);
    await peer.getByRole("switch", { name: /^Call ringtone/ }).check();
    await peer.getByRole("switch", { name: /^Notification sound/ }).uncheck();
    await closeSettings(peer);
    await page.getByRole("button", { name: "Voice call", exact: true }).click();
    await expect.poll(() => ringing(peer)).toBe(1);
    await page.getByRole("button", { name: "Hang up", exact: true }).click();
    await expect(peer.locator(".call-window")).toHaveCount(0);
    await expect.poll(() => ringing(peer)).toBe(0);
  } finally {
    await context.close();
  }
});

test("real messages chime outside the chat, settings preview plays, and disabled or muted chats stay quiet", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3001",
  });
  const peer = await context.newPage();
  await inspectAudio(page);
  await inspectAudio(peer);
  try {
    await login(page, "Alex Rivera");
    await login(peer, "Priya Sharma");
    await page
      .locator(".conversation-select")
      .filter({ hasText: "Priya Sharma" })
      .click();
    await peer.getByRole("link", { name: "Stories", exact: true }).click();
    const send = async (body: string) => {
      await page.getByLabel("Message", { exact: true }).fill(body);
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page
          .getByRole("article", { name: `You: ${body}`, exact: true })
          .getByLabel("delivered", { exact: true }),
      ).toBeVisible();
    };
    await send(`Sound check ${Date.now()}`);
    await expect.poll(() => chimes(peer)).toBe(1);
    expect(await chimes(page)).toBe(0);
    await settings(peer);
    await peer
      .getByRole("button", { name: "Test notification sound", exact: true })
      .click();
    await expect.poll(() => chimes(peer)).toBe(2);
    await expect
      .poll(async () => (await audio(peer)).at(-1)!.peak)
      .toBeGreaterThan(0.01);
    await peer.getByRole("switch", { name: /^Notification sound/ }).uncheck();
    await expect(
      peer.getByRole("button", {
        name: "Test notification sound",
        exact: true,
      }),
    ).toBeDisabled();
    await closeSettings(peer);
    await send(`Quiet setting ${Date.now()}`);
    expect(await chimes(peer)).toBe(2);
    await settings(peer);
    await peer.getByRole("switch", { name: /^Notification sound/ }).check();
    await closeSettings(peer);
    await peer
      .getByRole("button", { name: "Conversations", exact: true })
      .click();
    await peer
      .locator(".conversation-select")
      .filter({ hasText: "Alex Rivera" })
      .click();
    await peer
      .getByRole("button", { name: "Conversation options", exact: true })
      .click();
    await peer
      .getByRole("menuitem", { name: "Mute notifications", exact: true })
      .click();
    const muted = peer.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith("/settings"),
    );
    await peer.getByRole("menuitem", { name: "1 hour", exact: true }).click();
    expect((await muted).ok()).toBe(true);
    await peer.getByRole("link", { name: "Stories", exact: true }).click();
    await send(`Muted chat ${Date.now()}`);
    expect(await chimes(peer)).toBe(2);
  } finally {
    await context.close();
  }
});
