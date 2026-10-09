import { test, expect, type Page } from "@playwright/test";

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

test("real-time typing animates gently and remains readable with reduced motion", async ({
  page,
  browser,
}) => {
  await signIn(page, "+15550000001");
  await page
    .locator(".conversation-select")
    .filter({ hasText: "Priya Sharma" })
    .click();
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3001",
  });
  try {
    const peer = await context.newPage();
    await signIn(peer, "+919876540102");
    await peer
      .locator(".conversation-select")
      .filter({ hasText: "Alex Rivera" })
      .click();
    const draft = peer.getByLabel("Message", { exact: true });
    await draft.fill("A draft that stays unsent");
    const indicator = page.getByRole("status", {
      name: "Priya Sharma is typing…",
      exact: true,
    });
    await expect(indicator).toBeVisible();
    expect(
      await indicator.locator(".typing-dot").evaluateAll((dots) =>
        dots.map((dot) => {
          const style = getComputedStyle(dot);
          return [
            style.animationName,
            style.animationDelay,
            style.animationDuration,
          ];
        }),
      ),
    ).toEqual([
      ["typing-dot", "0s", "1.4s"],
      ["typing-dot", "0.16s", "1.4s"],
      ["typing-dot", "0.32s", "1.4s"],
    ]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(indicator.locator(".chat-typing-description")).toHaveText(
      "Priya Sharma is typing…",
    );
    expect(
      await indicator
        .locator(".chat-typing-description")
        .evaluate((element) => getComputedStyle(element).clipPath),
    ).toBe("none");
    expect(
      await indicator
        .locator(".typing-dot")
        .evaluateAll((dots) =>
          dots.map((dot) => getComputedStyle(dot).animationName),
        ),
    ).toEqual(["none", "none", "none"]);
    await draft.fill("");
    await expect(indicator).toBeHidden();
  } finally {
    await context.close();
  }
});

test("phone controls have usable touch targets without overflowing narrow screens", async ({
  page,
}) => {
  await signIn(page, "+15550000001");
  const search = page.locator(".sidebar-tools .search-field");
  await expect(search).toBeVisible();
  expect((await search.boundingBox())!.height).toBe(28);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/chats");
    await expect(search).toBeVisible();
    expect((await search.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page
      .locator(".conversation-select")
      .filter({ hasText: "Priya Sharma" })
      .click();
    await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
    for (const control of await page
      .locator(
        ".chat-header .chat-icon-button:visible, .chat-composer .chat-icon-button:visible, .chat-send-button:visible",
      )
      .all()) {
      const bounds = (await control.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    await page
      .locator(".chat-bubble-text .chat-message-body")
      .last()
      .click({ button: "right" });
    const menu = page.getByRole("menu", {
      name: "Message actions",
      exact: true,
    });
    await expect(menu).toBeVisible();
    for (const reaction of await menu
      .locator(".chat-quick-reactions button")
      .all()) {
      const bounds = (await reaction.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await menu.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Back to conversations", exact: true })
      .click();
  }
});
