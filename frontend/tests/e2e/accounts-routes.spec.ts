import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

async function register(
  page: Page,
  phone: string,
  name: string,
  username: string,
) {
  await page.goto("/signup");
  await expect(page.getByLabel("Phone number", { exact: false })).toHaveValue(
    "",
  );
  await page.getByLabel("Phone number", { exact: false }).fill(phone);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your profile", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Your name", { exact: false }).fill(name);
  await page.getByLabel("Username", { exact: false }).fill(username);
  await page
    .getByRole("button", { name: "Start messaging", exact: true })
    .click();
  await expect(page).toHaveURL(/\/chats$/);
  await expect(page.locator(".conversation-select")).toHaveCount(1);
}

test("own-number accounts discover each other, exchange messages, pin independently, and retain conversation routes", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-9);
  const firstPhone = `+1981${suffix}`;
  const secondPhone = `+1982${suffix}`;
  const firstName = `Account One ${suffix}`;
  const secondName = `Account Two ${suffix}`;
  const firstUsername = `account_one_${suffix}`;
  const secondUsername = `account_two_${suffix}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await register(page, firstPhone, firstName, firstUsername);

  const peerContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3001",
  });
  try {
    const peer = await peerContext.newPage();
    peer.on("pageerror", (error) => errors.push(error.message));
    await register(peer, secondPhone, secondName, secondUsername);
    await page
      .locator(".sidebar-header")
      .getByRole("button", { name: "New conversation", exact: true })
      .click();
    await page.getByLabel("Find a person").fill(`@${secondUsername}`);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: new RegExp(secondName) })
      .click();
    await expect(page).toHaveURL(/\/chats\/\d+$/);
    const conversationUrl = page.url();
    const firstText = `Fresh-account message ${suffix}`;
    await page.getByLabel("Message", { exact: true }).fill(firstText);
    await page.getByLabel("Message", { exact: true }).press("Enter");
    await expect(
      page.getByRole("article", { name: `You: ${firstText}`, exact: true }),
    ).toBeVisible();

    await peer
      .locator(".conversation-select")
      .filter({ hasText: firstName })
      .click();
    await expect(
      peer.getByRole("article", {
        name: `${firstName}: ${firstText}`,
        exact: true,
      }),
    ).toBeVisible();
    const responseText = `Reply from my own account ${suffix}`;
    await peer.getByLabel("Message", { exact: true }).fill(responseText);
    await peer.getByLabel("Message", { exact: true }).press("Enter");
    await expect(
      page.getByRole("article", {
        name: `${secondName}: ${responseText}`,
        exact: true,
      }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Conversation details", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Pin conversation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Close details", exact: true })
      .click();
    await expect(page).toHaveURL(conversationUrl);
    await page.reload();
    await expect(page).toHaveURL(conversationUrl);
    await expect(
      page.getByRole("article", {
        name: `${secondName}: ${responseText}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.locator(".conversation-section").filter({ hasText: /pinned/i }),
    ).toBeVisible();
    await peer.reload();
    await expect(
      peer.locator(".conversation-section").filter({ hasText: /pinned/i }),
    ).not.toBeVisible();

    await page.goto("/chats");
    await page
      .locator(".conversation-select")
      .filter({ hasText: secondName })
      .click();
    await expect(page).toHaveURL(conversationUrl);
    await page.goBack();
    await expect(page).toHaveURL(/\/chats$/);
    await page.goForward();
    await expect(page).toHaveURL(conversationUrl);
    await expect(
      page.getByRole("article", {
        name: `${secondName}: ${responseText}`,
        exact: true,
      }),
    ).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "Back to conversations", exact: true })
      .click();
    await expect(page).toHaveURL(/\/chats$/);
    await expect(page.locator(".app-sidebar")).toBeVisible();
    await page
      .locator(".conversation-select")
      .filter({ hasText: secondName })
      .click();
    await page
      .getByRole("button", { name: "Conversation details", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Unpin conversation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Close details", exact: true })
      .click();

    await page.goto("/chats/999999999");
    await expect(
      page.getByRole("heading", {
        name: "Conversation unavailable",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Back to chats", exact: true })
      .click();
    await expect(page).toHaveURL(/\/chats$/);
    expect(errors).toEqual([]);
  } finally {
    await peerContext.close();
  }
});

test("public entry links, protected return routes, and invalid routes stay within the app", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator(".site-header")
    .getByRole("link", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(
    page.getByRole("heading", { name: "Create your account", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Signal home", exact: true }).click();
  await page
    .locator(".site-header")
    .getByRole("link", { name: "Open messenger", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/chats/999999999");
  await expect(page).toHaveURL(/\/login\?next=%2Fchats%2F999999999$/);
  await page
    .locator(".auth-switch")
    .getByRole("link", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/signup\?next=%2Fchats%2F999999999$/);
  await page
    .locator(".auth-switch")
    .getByRole("link", { name: "Sign in", exact: true })
    .click();
  await page.getByRole("button", { name: "Alex Rivera", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  await expect(page).toHaveURL(/\/chats\/999999999$/);
  await expect(
    page.getByRole("heading", {
      name: "Conversation unavailable",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/login?next=https%3A%2F%2Fexample.com");
  await expect(page).toHaveURL(/\/chats$/);

  await page.goto("/chats/not-a-number");
  await expect(
    page.getByRole("heading", { name: "Page not found", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open messenger", exact: true }).click();
  await expect(page).toHaveURL(/\/chats$/);
  await page.goto("/signup");
  await expect(
    page.getByRole("heading", {
      name: "You’re already signed in",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use another number", exact: true })
    .click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByLabel("Phone number", { exact: false })).toHaveValue(
    "",
  );
});

test("account and messenger screens stay usable from a small phone to desktop", async ({
  page,
}) => {
  for (const route of ["/login", "/signup"]) {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(route);
      await expect(
        page.getByLabel("Phone number", { exact: false }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
  }
  await page.goto("/login");
  await page.getByRole("button", { name: "Alex Rivera", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/chats");
    await page
      .locator(".conversation-select")
      .filter({ hasText: "Priya Sharma" })
      .click();
    await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("region", {
        name: "Conversation with Priya Sharma",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (width === 390 || width === 1440) {
      await expect(page.getByRole("article").first()).toBeVisible();
      await page.screenshot({
        path: path.resolve(`../.runtime/polished-chat-${width}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Back to conversations", exact: true })
    .click();
  await expect(page.locator(".app-sidebar")).toBeVisible();
  await page.screenshot({
    path: path.resolve("../.runtime/polished-mobile-chats.png"),
  });
});
