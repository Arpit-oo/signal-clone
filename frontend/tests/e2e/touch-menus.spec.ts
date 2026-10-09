import { test, expect, type Locator, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Phone number", { exact: false }).fill("+15550000001");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  await expect(page).toHaveURL(/\/chats$/);
}

async function hold(page: Page, target: Locator, menu: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    });
    await expect(menu).toBeVisible();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(menu).toBeVisible();
  } finally {
    await session.detach();
  }
}

test("touch holds open usable conversation and message menus without activating the ordinary tap", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3001",
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await signIn(page);
    const chat = page
      .locator(".conversation-select")
      .filter({ hasText: "Weekend Hikers" });
    const chatMenu = page.getByRole("menu", {
      name: "Options for Weekend Hikers",
      exact: true,
    });
    await hold(page, chat, chatMenu);
    await expect(page).toHaveURL(/\/chats$/);
    // A following touch on the menu must work after the hold's click is suppressed.
    await chatMenu
      .getByRole("menuitem", { name: "Pin conversation", exact: true })
      .tap();
    await expect(chatMenu).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Unpin Weekend Hikers", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await chat.tap();
    await expect(page.locator(".chat-header-contact")).toContainText(
      "Weekend Hikers",
    );
    const bubble = page.locator(".chat-message-row .chat-bubble-text").last();
    const text = await bubble.locator(".chat-message-body").innerText();
    const messageMenu = page.getByRole("menu", {
      name: "Message actions",
      exact: true,
    });
    await hold(page, bubble, messageMenu);
    await messageMenu
      .getByRole("menuitem", { name: "Reply", exact: true })
      .tap();
    await expect(page.locator(".chat-compose-context")).toContainText(text);
    await page.getByRole("button", { name: "Cancel reply", exact: true }).tap();
    await expect(page.locator(".chat-compose-context")).toBeHidden();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("right-click and keyboard context menus preserve navigation and restore focus", async ({
  page,
}) => {
  await signIn(page);
  const chat = page
    .locator(".conversation-select")
    .filter({ hasText: "Priya Sharma" });
  const menu = page.getByRole("menu", {
    name: "Options for Priya Sharma",
    exact: true,
  });
  await chat.click({ button: "right" });
  await expect(menu).toBeVisible();
  await expect(page).toHaveURL(/\/chats$/);
  await page.keyboard.press("Escape");
  await expect(chat).toBeFocused();
  await chat.press("Shift+F10");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await chat.click();
  await expect(page.locator(".chat-header-contact")).toContainText(
    "Priya Sharma",
  );
  await expect(page.locator(".chat-history-state")).toBeHidden();
  const bubble = page.locator(".chat-message-row .chat-bubble-text").last();
  await bubble.locator(".chat-message-body").click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Message actions", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    bubble
      .locator("xpath=../..")
      .getByRole("button", { name: "Message actions", exact: true }),
  ).toBeFocused();
});

test("moving a touch cancels the menu hold so the conversation list can scroll", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3001",
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await signIn(page);
    const list = page.locator(".conversation-list");
    const chat = page.locator(".conversation-select").first();
    const box = (await chat.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const session = await context.newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - 25 }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - 70 }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(() => list.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    // Observe beyond the hold threshold to catch a timer that wasn't cancelled.
    await page.waitForTimeout(600);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page).toHaveURL(/\/chats$/);
    await session.detach();
  } finally {
    await context.close();
  }
});
