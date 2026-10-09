import { test, expect, type Page } from "@playwright/test";

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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test("sidebar search ignores late responses, retries failures, and restores menu focus", async ({
  page,
}) => {
  await signIn(page);
  const entered = deferred();
  const release = deferred();
  let failMarcus = false;
  await page.route("**/api/search?*", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "Priya") {
      const response = await route.fetch();
      entered.resolve();
      await release.promise;
      await route.fulfill({ response });
    } else if (query === "Marcus" && failMarcus) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Search temporarily unavailable" }),
      });
    } else await route.continue();
  });
  try {
    const search = page.getByLabel("Search all conversations", { exact: true });
    await search.fill("Priya");
    await entered.promise;
    await search.fill("Marcus");
    const results = page.locator(".sidebar-search-results");
    await expect(
      results.getByRole("button", { name: /Marcus Chen/ }),
    ).toBeVisible();
    const staleResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/search" &&
        new URL(response.url()).searchParams.get("q") === "Priya",
    );
    release.resolve();
    await staleResponse;
    await expect(results).toContainText("Marcus Chen");
    await expect(results).not.toContainText("Priya Sharma");

    failMarcus = true;
    await search.fill("Marcus ");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Search temporarily unavailable" }),
    ).toBeVisible();
    failMarcus = false;
    await page
      .getByRole("button", { name: "Retry search", exact: true })
      .click();
    await expect(
      results.getByRole("button", { name: /Marcus Chen/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Clear search", exact: true })
      .click();

    const trigger = page.getByRole("button", {
      name: "Options for Priya Sharma",
      exact: true,
    });
    await page.locator(".conversation-row").filter({ hasText: "Priya Sharma" }).hover();
    await trigger.click();
    const menu = page.getByRole("menu", {
      name: "Options for Priya Sharma",
      exact: true,
    });
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("End");
    await expect(
      menu.getByRole("menuitem", { name: "Conversation details", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  } finally {
    release.resolve();
  }
});

test("search jumps to unloaded history, returns to latest, and closes on mobile selection", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  const token = await page.evaluate(() => localStorage.getItem("signal-token"));
  const headers = { Authorization: `Bearer ${token}` };
  const response = await page.request.get("/api/conversations", { headers });
  expect(response.ok()).toBe(true);
  const conversations: Array<{ id: number; type: string }> =
    await response.json();
  const id = conversations.find(
    (conversation) => conversation.type === "note_to_self",
  )!.id;
  const prefix = `SearchHistory${Date.now()}`;
  const firstText = `${prefix} needle: the first message in older history.`;
  const lastText = `${prefix} latest: the last message in this conversation.`;
  for (let index = 0; index < 55; index++) {
    const sent = await page.request.post(`/api/conversations/${id}/messages`, {
      headers,
      data: {
        client_id: `${prefix}-${index}`,
        body:
          index === 0
            ? firstText
            : index === 54
              ? lastText
              : `${prefix} item ${index}: ${"A historical message that wraps across the screen. ".repeat(4)}`,
      },
    });
    expect(sent.status()).toBe(201);
  }
  await page.goto(`/chats/${id}`);
  await page.reload();
  const first = page.getByRole("article", {
    name: `You: ${firstText}`,
    exact: true,
  });
  const last = page.getByRole("article", {
    name: `You: ${lastText}`,
    exact: true,
  });
  await expect(last).toBeInViewport();
  await expect(first).toHaveCount(0);

  const trigger = page.getByRole("button", {
    name: "Search conversation",
    exact: true,
  });
  await trigger.click();
  const query = page.getByLabel("Search messages in this conversation", {
    exact: true,
  });
  await query.fill(`${prefix} needle`);
  await page
    .locator(".chat-search-result")
    .filter({ hasText: firstText })
    .click();
  await expect(first).toBeInViewport();
  await query.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.locator(".chat-search-panel")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Jump to latest messages", exact: true })
    .click();
  await expect(last).toBeInViewport();

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await query.fill(`${prefix} needle`);
  await page
    .locator(".chat-search-result")
    .filter({ hasText: firstText })
    .click();
  await expect(page.locator(".chat-search-panel")).toHaveCount(0);
  await expect(first).toBeInViewport();
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
});
