import { test, expect, type Page } from "@playwright/test";

async function verify(page: Page, phone: string) {
  await page.goto("/signup");
  await expect(page.getByLabel("Country code", { exact: true })).toHaveValue(
    "+91",
  );
  await page.getByLabel("Phone number", { exact: true }).fill(phone);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Verify your number", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".login-card")).toContainText("+919877032297");
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  const response = page.waitForResponse(
    (response) =>
      response.url().includes("/auth/verify") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  return (await response).json();
}

test("repeated signup with national and international spellings opens one account and keeps its messages", async ({
  page,
  browser,
}) => {
  const original = await verify(page, "9877032297");
  expect(original.is_new).toBe(true);
  await page
    .getByLabel("Your name", { exact: false })
    .fill("Phone Identity User");
  await page
    .getByRole("button", { name: "Start messaging", exact: true })
    .click();
  await page
    .locator(".conversation-select")
    .filter({ hasText: "Note to Self" })
    .click();
  const note = "My account and history must survive repeated signup";
  await page.getByLabel("Message", { exact: true }).fill(note);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("article", { name: `You: ${note}`, exact: true }),
  ).toBeVisible();
  for (const phone of ["+91 98770 32297", "+9877032297", "9877032297"]) {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:3001",
      viewport: { width: 390, height: 844 },
    });
    try {
      const returning = await context.newPage();
      const result = await verify(returning, phone);
      expect(result.is_new).toBe(false);
      expect(result.user.id).toBe(original.user.id);
      expect(result.user.display_name).toBe("Phone Identity User");
      await expect(returning).toHaveURL(/\/chats$/);
      await expect(
        returning.getByRole("heading", { name: "Your profile", exact: true }),
      ).toHaveCount(0);
      await returning
        .locator(".conversation-select")
        .filter({ hasText: "Note to Self" })
        .click();
      await expect(
        returning.getByRole("article", { name: `You: ${note}`, exact: true }),
      ).toBeVisible();
      expect(
        await returning.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await context.close();
    }
  }
});
