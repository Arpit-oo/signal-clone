import { test, expect } from "@playwright/test";
import path from "node:path";

test("reference homepage serves local assets, navigates to the messenger, and keeps marketing colors in dark mode", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("signal-prefs", JSON.stringify({ state: { theme: "dark" }, version: 0 })));
  await page.setViewportSize({ width: 1818, height: 1100 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Speak Freely" })).toBeVisible();
  await expect(page.locator(".signal-site")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.locator(".site-footer").scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator(".signal-site img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.resolve("../.runtime/homepage-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "English", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Select your language" });
  await expect(dialog.getByRole("link", { name: "हिन्दी", exact: true })).toHaveAttribute("href", "https://signal.org/hi/");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "English", exact: true })).toBeFocused();
  await page.getByRole("link", { name: "Get Signal", exact: true }).last().click();
  await expect(page).toHaveURL(/\/download$/);
  await expect(page.getByRole("link", { name: "Android", exact: true }).first()).toHaveAttribute("href", "https://signal.org/download/android/");
  await page.getByRole("link", { name: "Open web messenger" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("homepage remains available without the API and adapts from small phones to desktop", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  for (const width of [320, 390, 768, 1024, 1818]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Speak Freely" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 390) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
      await page.locator(".site-footer").scrollIntoViewIfNeeded();
      await expect.poll(() => page.locator(".signal-site img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete))).toBe(true);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.resolve("../.runtime/homepage-mobile.png"), fullPage: true });
    }
  }
});
