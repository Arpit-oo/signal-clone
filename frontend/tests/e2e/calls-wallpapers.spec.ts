import { expect, test, type Page } from "@playwright/test";

test.use({
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  },
});

async function signIn(page: Page, name: string) {
  await page.goto("/login");
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  await expect(page.locator(".conversation-select").first()).toBeVisible();
}
async function openChat(page: Page, name: string) {
  await page.locator(".conversation-select").filter({ hasText: name }).click();
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
}
async function inspectRtc(page: Page) {
  await page.addInitScript(() => {
    const original = window.RTCPeerConnection;
    const connections: RTCPeerConnection[] = [];
    Object.assign(window, { __testConnections: connections });
    window.RTCPeerConnection = class extends original {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        connections.push(this);
      }
    };
  });
}
async function bytesReceived(page: Page) {
  return page.evaluate(async () => {
    const peers = (
      window as unknown as { __testConnections: RTCPeerConnection[] }
    ).__testConnections;
    const stats = await peers.at(-1)?.getStats();
    let bytes = 0;
    stats?.forEach((entry) => {
      if (entry.type === "inbound-rtp")
        bytes += Number(entry.bytesReceived ?? 0);
    });
    return bytes;
  });
}

for (const kind of ["voice", "video"] as const) {
  test(`real ${kind} call exchanges media, supports controls, survives navigation, and releases devices`, async ({
    page,
    browser,
  }) => {
    const peerContext = await browser.newContext({
      baseURL: "http://127.0.0.1:3001",
      permissions: ["microphone", "camera"],
    });
    const peer = await peerContext.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    peer.on("pageerror", (e) => errors.push(e.message));
    await inspectRtc(page);
    await inspectRtc(peer);
    try {
      await signIn(page, "Alex Rivera");
      await signIn(peer, "Priya Sharma");
      // Incoming calls must arrive on Stories too, without an open chat pane.
      await peer
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Stories", exact: true })
        .click();
      await openChat(page, "Priya Sharma");
      await page
        .getByRole("button", {
          name: kind === "video" ? "Video call" : "Voice call",
          exact: true,
        })
        .click();
      await expect(
        peer.getByRole("button", { name: "Accept call", exact: true }),
      ).toBeVisible();
      await expect(
        peer.getByLabel("Call status", { exact: true }),
      ).toContainText(`Incoming ${kind} call`);
      await peer
        .getByRole("button", { name: "Accept call", exact: true })
        .click();
      await expect(
        page.getByLabel("Call status", { exact: true }),
      ).toHaveAttribute("data-phase", "connected");
      await expect(
        peer.getByLabel("Call status", { exact: true }),
      ).toHaveAttribute("data-phase", "connected");
      await expect.poll(() => bytesReceived(page)).toBeGreaterThan(0);
      await expect.poll(() => bytesReceived(peer)).toBeGreaterThan(0);
      await page
        .getByRole("button", { name: "Mute microphone", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Unmute microphone", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        await page.evaluate(
          () =>
            (
              window as unknown as { __testConnections: RTCPeerConnection[] }
            ).__testConnections
              .at(-1)
              ?.getSenders()
              .find((s) => s.track?.kind === "audio")?.track?.enabled,
        ),
      ).toBe(false);
      await page
        .getByRole("button", { name: "Unmute microphone", exact: true })
        .click();
      if (kind === "video") {
        await expect
          .poll(() =>
            peer
              .locator('video[aria-label="Remote video"]')
              .evaluate((element) => (element as HTMLVideoElement).videoWidth),
          )
          .toBeGreaterThan(0);
        await page
          .getByRole("button", { name: "Turn camera off", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Turn camera on", exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Turn camera on", exact: true })
          .click();
      }
      await page.getByRole("button", { name: "Hang up", exact: true }).click();
      await expect(page.locator(".call-window")).toHaveCount(0);
      await expect(peer.locator(".call-window")).toHaveCount(0);
      expect(
        await page.evaluate(() => {
          const pc = (
            window as unknown as { __testConnections: RTCPeerConnection[] }
          ).__testConnections.at(-1)!;
          return {
            state: pc.connectionState,
            stopped: pc
              .getSenders()
              .every((s) => !s.track || s.track.readyState === "ended"),
          };
        }),
      ).toEqual({ state: "closed", stopped: true });
      expect(errors).toEqual([]);
    } finally {
      await peerContext.close();
    }
  });
}

test("declining a call dismisses both windows and allows another call", async ({
  page,
  browser,
}) => {
  const peerContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3001",
  });
  try {
    const peer = await peerContext.newPage();
    await signIn(page, "Alex Rivera");
    await signIn(peer, "Priya Sharma");
    await openChat(page, "Priya Sharma");
    for (let i = 0; i < 2; i++) {
      await page
        .getByRole("button", { name: "Voice call", exact: true })
        .click();
      await peer
        .getByRole("button", { name: "Decline call", exact: true })
        .click();
      await expect(page.locator(".call-window")).toHaveCount(0);
      await expect(peer.locator(".call-window")).toHaveCount(0);
    }
  } finally {
    await peerContext.close();
  }
});

test("newly registered accounts can call each other without seeded contacts", async ({ page, browser }) => {
  const suffix = Date.now().toString().slice(-8);
  const numbers = [`+9190${suffix}`, `+9188${suffix}`];
  const names = [`New caller ${suffix}`, `New partner ${suffix}`];
  const accounts = [];
  for (let index = 0; index < 2; index++) {
    const response = await page.request.post("/api/auth/verify", { data: { phone: numbers[index], code: "123456" } });
    expect(response.ok()).toBe(true);
    const auth = await response.json();
    const profile = await page.request.patch("/api/me", { headers: { Authorization: `Bearer ${auth.token}` }, data: { display_name: names[index] } });
    expect(profile.ok()).toBe(true);
    accounts.push(auth);
  }
  const conversation = await page.request.post("/api/conversations", { headers: { Authorization: `Bearer ${accounts[0].token}` }, data: { type: "direct", member_ids: [accounts[1].user.id] } });
  expect(conversation.ok()).toBe(true);
  const peerContext = await browser.newContext({ baseURL: "http://127.0.0.1:3001", permissions: ["microphone"] });
  try {
    const peer = await peerContext.newPage();
    for (const [tab, phone] of [[page, numbers[0]], [peer, numbers[1]]] as const) {
      await inspectRtc(tab);
      await tab.goto("/login");
      await tab.getByLabel("Phone number", { exact: true }).fill(phone);
      await tab.getByRole("button", { name: "Continue", exact: true }).click();
      await tab.getByLabel("Verification code", { exact: true }).fill("123456");
      await tab.getByRole("button", { name: "Verify and continue", exact: true }).click();
      await expect(tab.locator(".conversation-select").first()).toBeVisible();
    }
    await openChat(page, names[1]);
    await page.getByRole("button", { name: "Voice call", exact: true }).click();
    await peer.getByRole("button", { name: "Accept call", exact: true }).click();
    await expect(page.getByLabel("Call status", { exact: true })).toHaveAttribute("data-phase", "connected");
    await expect.poll(() => bytesReceived(peer)).toBeGreaterThan(0);
    await peer.getByRole("button", { name: "Hang up", exact: true }).click();
    await expect(page.locator(".call-window")).toHaveCount(0);
  } finally { await peerContext.close(); }
});

test("chat menu, private wallpapers, reload persistence and full-screen settings work on desktop and phone", async ({
  page,
  browser,
}) => {
  await signIn(page, "Alex Rivera");
  await openChat(page, "Priya Sharma");
  await page
    .getByRole("button", { name: "Conversation options", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Disappearing messages", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("menuitem", { name: "Chat background", exact: true })
    .click();
  await page.getByRole("button", { name: "Sky", exact: true }).click();
  await page
    .getByRole("button", { name: "Set background", exact: true })
    .click();
  await expect(page.locator(".chat-main")).toHaveClass(/has-wallpaper/);
  await page.reload();
  await expect(page.locator(".chat-main")).toHaveClass(/has-wallpaper/);
  const peerContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3001",
  });
  try {
    const peer = await peerContext.newPage();
    await signIn(peer, "Priya Sharma");
    await openChat(peer, "Alex Rivera");
    await expect(peer.locator(".chat-main")).not.toHaveClass(/has-wallpaper/);
  } finally {
    await peerContext.close();
  }
  await page
    .getByRole("button", { name: "Conversation options", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Chat background", exact: true })
    .click();
  const png = await page.locator(".wallpaper-preview").screenshot();
  await page
    .getByLabel("Upload chat background", { exact: true })
    .setInputFiles({
      name: "wallpaper.png",
      mimeType: "image/png",
      buffer: png,
    });
  await expect(page.locator(".wallpaper-dialog")).toHaveCount(0);
  await expect(page.locator(".chat-main")).toHaveCSS(
    "background-image",
    /wallpaper/,
  );
  await page.reload();
  await expect(page.locator(".chat-main")).toHaveCSS(
    "background-image",
    /wallpaper/,
  );
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page
      .getByRole("button", { name: "Conversation options", exact: true })
      .click();
    const menu = page.locator('.chat-options-menu[role="menu"]').first();
    const bounds = await menu.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    if (width < 720)
      await page
        .getByRole("button", { name: "Back to conversations", exact: true })
        .click();
    await page.getByRole("button", { name: width < 720 ? "Your profile" : "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await expect(settings).toBeVisible();
    await expect
      .poll(async () => Math.round((await settings.boundingBox())!.width))
      .toBe(width);
    await settings
      .getByRole("button", { name: "Appearance", exact: true })
      .click();
    await expect(settings.getByLabel("Theme", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await settings
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(settings).toHaveCount(0);
    if (width < 720) await openChat(page, "Priya Sharma");
  }
  await page
    .getByRole("button", { name: "Conversation options", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Chat background", exact: true })
    .click();
  await page.getByRole("button", { name: "Default", exact: true }).click();
  await page
    .getByRole("button", { name: "Set background", exact: true })
    .click();
  await expect(page.locator(".chat-main")).not.toHaveClass(/has-wallpaper/);
});
