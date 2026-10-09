import { test, expect } from "@playwright/test";
import path from "node:path";

test("phone verification and profile onboarding remain readable on short mobile screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/signup");
  await page
    .getByLabel("Phone number", { exact: false })
    .fill(`+1973${String(Date.now()).slice(-7)}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Verify your number", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  await page
    .getByLabel("Your name", { exact: false })
    .fill("Short Screen User");
  await expect(
    page.getByRole("button", { name: "Start messaging", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: path.resolve("../.runtime/auth-profile-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Start messaging", exact: true })
    .click();
  await expect(page).toHaveURL(/\/chats$/);
});
