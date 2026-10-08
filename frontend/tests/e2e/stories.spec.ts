import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

async function signIn(page: Page, phone: string) {
  await page.goto("/login");
  await page.getByLabel("Phone number", { exact: false }).fill(phone);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  await expect(page).toHaveURL(/\/chats$/);
}

async function selectAudience(page: Page, name: string) {
  const composer = page.getByRole("dialog", {
    name: "Create story",
    exact: true,
  });
  await composer.getByLabel("Find people", { exact: true }).fill(name);
  await composer.getByRole("button", { name: new RegExp(name) }).click();
  await composer
    .getByRole("button", { name: "Share story", exact: true })
    .click();
  await expect(composer).toBeHidden();
}

test("Stories preserve the sign-in destination and share live with the selected audience", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/stories");
  await expect(page).toHaveURL(/\/login\?next=%2Fstories$/);
  await page.getByRole("button", { name: "Alex Rivera", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  await expect(page).toHaveURL(/\/stories$/);

  const peerContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3001",
  });
  try {
    const peer = await peerContext.newPage();
    peer.on("pageerror", (error) => errors.push(error.message));
    await signIn(peer, "+15550000002");
    await peer.getByRole("link", { name: "Stories", exact: true }).click();
    await expect(peer).toHaveURL(/\/stories$/);
    const body = `A story for Priya ${Date.now()}`;
    await page.getByRole("button", { name: "Add story", exact: true }).click();
    const composer = page.getByRole("dialog", {
      name: "Create story",
      exact: true,
    });
    await composer.getByLabel("Story text", { exact: true }).fill(body);
    await expect(
      composer.getByRole("button", { name: "Share story", exact: true }),
    ).toBeDisabled();
    await selectAudience(page, "Priya Sharma");

    // The other browser remains on the feed: a WebSocket change must reveal the post.
    await peer
      .getByRole("button", { name: "View Alex Rivera's story", exact: true })
      .click();
    const viewer = peer.getByRole("dialog", {
      name: "Story by Alex Rivera",
      exact: true,
    });
    await expect(viewer).toContainText(body);
    await viewer
      .getByRole("button", { name: "Pause story", exact: true })
      .click();
    await expect(
      viewer.getByRole("button", { name: "Resume story", exact: true }),
    ).toBeVisible();
    await viewer.press("Escape");
    await expect(viewer).toBeHidden();
    await peer.reload();
    await peer
      .getByRole("button", { name: "View Alex Rivera's story", exact: true })
      .click();
    await expect(viewer).toContainText(body);
    await viewer
      .getByRole("button", { name: "Pause story", exact: true })
      .click();

    await page.reload();
    await page
      .getByRole("button", { name: "View your story", exact: true })
      .click();
    const ownerViewer = page.getByRole("dialog", {
      name: "Story by Alex Rivera",
      exact: true,
    });
    await ownerViewer
      .getByRole("button", { name: "Pause story", exact: true })
      .click();
    await ownerViewer
      .getByRole("button", { name: "Story viewers", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Story viewers", exact: true }),
    ).toContainText("Priya Sharma");
    await page
      .getByRole("dialog", { name: "Story viewers", exact: true })
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    // Closing a dialog while its request is pending must keep it closed.
    let releaseViews!: () => void;
    const viewsGate = new Promise<void>((resolve) => {
      releaseViews = resolve;
    });
    await page.route("**/api/stories/*/views", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      await viewsGate;
      await route.fulfill({ response });
    });
    await ownerViewer
      .getByRole("button", { name: "Story viewers", exact: true })
      .click();
    const viewsDialog = page.getByRole("dialog", {
      name: "Story viewers",
      exact: true,
    });
    await expect(viewsDialog.getByLabel("Loading story viewers")).toBeVisible();
    await viewsDialog
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    const completedViews = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        /\/api\/stories\/\d+\/views$/.test(response.url()),
    );
    releaseViews();
    await completedViews;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(viewsDialog).toBeHidden();
    await page.unroute("**/api/stories/*/views");
    await ownerViewer
      .getByRole("button", { name: "Delete story", exact: true })
      .click();
    await page
      .getByRole("alertdialog", { name: "Delete story?", exact: true })
      .getByRole("button", { name: "Delete story", exact: true })
      .click();
    await expect(
      peer.getByRole("button", {
        name: "View Alex Rivera's story",
        exact: true,
      }),
    ).toBeHidden();
    await expect(viewer).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    await peerContext.close();
  }
});

test("photo Stories render on phones, retain privacy controls, and link back to chats", async ({
  page,
  browser,
}) => {
  await signIn(page, "+15550000003");
  await page.goto("/stories");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Add story", exact: true }).click();
  const composer = page.getByRole("dialog", {
    name: "Create story",
    exact: true,
  });
  await composer
    .getByRole("button", { name: "Photo or video", exact: true })
    .click();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAALElEQVR4nGN0C/3PQA3ARBVTGEYNIgaMBjZhMBpGhMFoGBEGo2FEGAy+MAIAncABysxmYMcAAAAASUVORK5CYII=",
    "base64",
  );
  await composer.locator("input[type=file]").setInputFiles({
    name: "story-photo.png",
    mimeType: "image/png",
    buffer: png,
  });
  await composer
    .getByLabel("Caption", { exact: true })
    .fill("A moment shared with one person");
  await selectAudience(page, "Alex Rivera");
  await page
    .getByRole("button", { name: "View your story", exact: true })
    .click();
  const viewer = page.getByRole("dialog", {
    name: "Story by Marcus Chen",
    exact: true,
  });
  await viewer
    .getByRole("button", { name: "Pause story", exact: true })
    .click();
  const image = viewer.getByRole("img", {
    name: "A moment shared with one person",
    exact: true,
  });
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(
      viewer.getByRole("button", { name: "Close story", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: path.resolve("../.runtime/stories-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.resolve("../.runtime/stories-mobile.png"),
  });
  await viewer
    .getByRole("button", { name: "Close story", exact: true })
    .click();
  await page.getByRole("link", { name: "Chats", exact: true }).click();
  await expect(page).toHaveURL(/\/chats$/);

  // The audience received the media post; a third account does not receive it.
  const otherContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3001",
  });
  try {
    const other = await otherContext.newPage();
    await signIn(other, "+15550000002");
    await other.goto("/stories");
    await expect(
      other.getByRole("heading", { name: "Stories", exact: true, level: 1 }),
    ).toBeVisible();
    await expect(
      other.getByRole("button", {
        name: "View Marcus Chen's story",
        exact: true,
      }),
    ).toBeHidden();
  } finally {
    await otherContext.close();
  }
});

test("uploaded video Stories play and private viewing receipts stay hidden", async ({
  page,
  browser,
}) => {
  await signIn(page, "+15550000002");
  await page.goto("/stories");
  // Record a real browser-supported clip rather than a file with only a video header.
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 360;
    const ctx = canvas.getContext("2d")!;
    const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    let frame = 0;
    const render = () => {
      ctx.fillStyle = frame++ % 2 ? "#7C407D" : "#3B45FD";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "white";
      ctx.font = "24px sans-serif";
      ctx.fillText("A moving story", 22, 180);
    };
    render();
    recorder.start();
    const timer = setInterval(render, 80);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    recorder.stop();
    await stopped;
    clearInterval(timer);
    stream.getTracks().forEach((track) => track.stop());
    const data = new Uint8Array(
      await new Blob(chunks, { type: "video/webm" }).arrayBuffer(),
    );
    return btoa(Array.from(data, (byte) => String.fromCharCode(byte)).join(""));
  });
  await page.getByRole("button", { name: "Add story", exact: true }).click();
  const composer = page.getByRole("dialog", {
    name: "Create story",
    exact: true,
  });
  await composer
    .getByRole("button", { name: "Photo or video", exact: true })
    .click();
  await composer
    .getByLabel("Story photo or video", { exact: true })
    .setInputFiles({
      name: "recorded-story.webm",
      mimeType: "video/webm",
      buffer: Buffer.from(base64, "base64"),
    });
  await composer
    .getByLabel("Caption", { exact: true })
    .fill("Video playback from persisted media");
  await selectAudience(page, "Alex Rivera");

  const peerContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3001",
  });
  try {
    const peer = await peerContext.newPage();
    await signIn(peer, "+15550000001");
    const updated = await peer.evaluate(async () => {
      const response = await fetch("/api/me", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("signal-token")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ read_receipts_enabled: false }),
      });
      return response.status;
    });
    expect(updated).toBe(200);
    await peer.goto("/stories");
    await peer
      .getByRole("button", { name: "View Priya Sharma's story", exact: true })
      .click();
    const viewer = peer.getByRole("dialog", {
      name: "Story by Priya Sharma",
      exact: true,
    });
    const video = viewer.locator("video");
    await expect(video).toBeVisible();
    await expect
      .poll(() =>
        video.evaluate((node) => (node as HTMLVideoElement).videoWidth),
      )
      .toBe(240);
    await expect
      .poll(() =>
        video.evaluate((node) => (node as HTMLVideoElement).currentTime),
      )
      .toBeGreaterThan(0);
    await viewer
      .getByRole("button", { name: "Pause story", exact: true })
      .click();
    await page
      .getByRole("button", { name: "View your story", exact: true })
      .click();
    const ownerViewer = page.getByRole("dialog", {
      name: "Story by Priya Sharma",
      exact: true,
    });
    await ownerViewer
      .getByRole("button", { name: "Pause story", exact: true })
      .click();
    await ownerViewer
      .getByRole("button", { name: "Story viewers", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Story viewers", exact: true }),
    ).not.toContainText("Alex Rivera");
    // Restore the shared seeded account's setting for other tests.
    expect(
      await peer.evaluate(
        async () =>
          (
            await fetch("/api/me", {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${localStorage.getItem("signal-token")}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ read_receipts_enabled: true }),
            })
          ).status,
      ),
    ).toBe(200);
  } finally {
    await peerContext.close();
  }
});
