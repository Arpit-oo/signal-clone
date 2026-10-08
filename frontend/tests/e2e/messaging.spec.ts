import { test, expect, type Page } from "@playwright/test";

async function signIn(page: Page, phone: string) {
  await page.goto("/login");
  await page.getByLabel("Phone number", { exact: false }).fill(phone);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
}
async function openChat(page: Page, name: string) {
  await page.locator(".conversation-select").filter({ hasText: name }).click();
  await expect(page.getByRole("region", { name: `Conversation with ${name}`, exact: true })).toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
}
async function actions(page: Page, messageLabel: string, action: string) {
  await page.getByRole("article", { name: messageLabel, exact: true }).getByRole("button", { name: "Message actions" }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

test("phone verification, two-user real-time delivery, reactions, replies, editing, attachments and deletion", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await page.getByRole("button", { name: "Alex Rivera", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("000000");
  await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
  await expect(page.locator(".login-card").getByRole("alert")).toContainText("Incorrect code");
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
  await openChat(page, "Priya Sharma");

  const peerContext = await browser.newContext({ baseURL: "http://127.0.0.1:3001" });
  try {
    const peer = await peerContext.newPage();
    peer.on("pageerror", (error) => errors.push(error.message));
    await signIn(peer, "+15550000002");
    await openChat(peer, "Alex Rivera");
    const text = `Browser delivery ${Date.now()}`;
    await page.getByLabel("Message", { exact: true }).fill(text);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    const outgoing = page.getByRole("article", { name: `You: ${text}`, exact: true });
    const incoming = peer.getByRole("article", { name: `Alex Rivera: ${text}`, exact: true });
    await expect(incoming).toBeVisible();
    await expect(outgoing.getByLabel("sending", { exact: true })).toHaveCount(0);
    await peer.bringToFront();
    await expect(outgoing.getByLabel("read", { exact: true })).toBeVisible();
    await incoming.getByRole("button", { name: "Message actions" }).click();
    await peer.getByRole("menuitem", { name: "React with 👍", exact: true }).click();
    await expect(outgoing.getByRole("button", { name: "👍, 1 reaction", exact: true })).toBeVisible();

    await actions(peer, `Alex Rivera: ${text}`, "Reply");
    const reply = `Reply received ${Date.now()}`;
    await peer.getByLabel("Message", { exact: true }).fill(reply);
    await peer.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("article", { name: `Priya Sharma: ${reply}`, exact: true })).toContainText(text);

    await actions(page, `You: ${text}`, "Edit message");
    const edited = `${text} edited`;
    await page.getByLabel("Edit message", { exact: true }).fill(edited);
    await page.getByRole("button", { name: "Save edited message", exact: true }).click();
    await expect(peer.getByRole("article", { name: `Alex Rivera: ${edited}`, exact: true })).toContainText("Edited");

    await page.locator(".chat-composer-wrap input[type=file], .chat-composer-area input[type=file], .chat-composer input[type=file]").first().setInputFiles({ name: "browser-notes.txt", mimeType: "text/plain", buffer: Buffer.from("An attachment delivered through the real API.") });
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(peer.getByRole("link", { name: /browser-notes.txt/ }).last()).toBeVisible();
    const link = await peer.getByRole("link", { name: /browser-notes.txt/ }).last().getAttribute("href");
    const download = await peer.request.get(link!);
    expect(download.status()).toBe(200);
    expect(await download.text()).toContain("delivered through the real API");

    await actions(page, `You: ${edited}`, "Delete");
    await page.getByRole("button", { name: "Delete for everyone", exact: true }).click();
    await expect(peer.getByRole("article", { name: "Alex Rivera: Deleted message", exact: true }).last()).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await peerContext.close(); }
});

test("group creation, administrative details, appearance persistence and mobile navigation", async ({ page }) => {
  await signIn(page, "+15550000001");
  await page.locator(".sidebar-header").getByRole("button", { name: "New conversation", exact: true }).click();
  await page.getByRole("button", { name: "New group", exact: true }).click();
  const name = `Browser group ${Date.now()}`;
  await page.getByLabel("Group name", { exact: true }).fill(name);
  await page.getByRole("dialog").getByRole("button", { name: /Priya Sharma/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Marcus Chen/ }).click();
  await page.getByRole("button", { name: "Create group", exact: true }).click();
  await expect(page.getByRole("region", { name: `Conversation with ${name}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Conversation details", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Group details", exact: true })).toBeVisible();
  await expect(page.locator(".group-member")).toHaveCount(3);
  await page.getByLabel("Disappearing message timer").selectOption("300");
  await expect(page.getByRole("button", { name: /Disappearing messages set to/ })).toBeVisible();
  await page.getByRole("button", { name: "Close details", exact: true }).click();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("region", { name: `Conversation with ${name}`, exact: true })).toBeVisible();
  await expect(page.locator(".app-sidebar")).toBeHidden();
  await page.getByRole("button", { name: "Back to conversations", exact: true }).click();
  await expect(page.locator(".app-sidebar")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("new accounts complete a profile and can use Note to Self", async ({ page }) => {
  const phone = `+1999${String(Date.now()).slice(-7)}`;
  await signIn(page, phone);
  await expect(page.getByRole("heading", { name: "Your profile", exact: true })).toBeVisible();
  await page.getByLabel("Your name", { exact: false }).fill("Browser New User");
  await page.getByRole("button", { name: /Start messaging|Save profile|Continue/, exact: false }).click();
  await openChat(page, "Note to Self");
  const note = "Remember to verify fresh account onboarding.";
  await page.getByLabel("Message", { exact: true }).fill(note);
  await page.getByLabel("Message", { exact: true }).press("Enter");
  await expect(page.getByRole("article", { name: `You: ${note}`, exact: true })).toBeVisible();
  await page.reload();
  await openChat(page, "Note to Self");
  await expect(page.getByRole("article", { name: `You: ${note}`, exact: true })).toBeVisible();
});

test("long timelines preserve the latest and historical position when resizing and menus restore keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "+15550000001");
  await openChat(page, "Note to Self");
  const prefix = `Resize ${Date.now()}`;
  for (let index = 0; index < 12; index++) {
    const text = `${prefix} ${index}: ${"A longer note that wraps when the conversation moves to a smaller screen. ".repeat(5)}`;
    await page.getByLabel("Message", { exact: true }).fill(text);
    await page.getByLabel("Message", { exact: true }).press("Enter");
    await expect(page.getByRole("article", { name: `You: ${text}`, exact: true })).toBeVisible();
  }
  const timeline = page.locator(".chat-timeline");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => timeline.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(5);
  await timeline.evaluate((el) => { el.scrollTop -= 700; el.dispatchEvent(new Event("scroll")); });
  const anchor = await timeline.evaluate((el) => {
    const top = el.getBoundingClientRect().top;
    return [...el.querySelectorAll("article")].find((article) => article.getBoundingClientRect().bottom > top + 5)?.id;
  });
  expect(anchor).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => page.locator(`[id="${anchor}"]`).evaluate((el) => {
    const r = el.getBoundingClientRect(), t = el.closest(".chat-timeline")!.getBoundingClientRect();
    return r.bottom > t.top && r.top < t.bottom;
  })).toBe(true);
  await timeline.evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
  await page.getByRole("button", { name: "Jump to latest messages" }).click();
  const trigger = page.getByRole("article").last().getByRole("button", { name: "Message actions" });
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("contacts retry recovers and profile drafts survive tab changes with nested sign-out dismissal", async ({ page }) => {
  await signIn(page, "+15550000001");
  let failContacts = true;
  await page.route("**/api/contacts", (route) => failContacts ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Temporarily offline" }) }) : route.continue());
  await page.locator(".sidebar-header").getByRole("button", { name: "New conversation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry contacts", exact: true })).toBeVisible();
  failContacts = false;
  await page.getByRole("button", { name: "Retry contacts", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: /Priya Sharma/ })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Your name", { exact: false }).fill("Unsaved profile draft");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(page.getByLabel("Your name", { exact: false })).toHaveValue("Unsaved profile draft");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Sign out", exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole("alertdialog", { name: "Sign out?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
});

test("queued attachments survive editing and switching conversations, and failed recording releases the microphone", async ({ page }) => {
  await page.addInitScript(() => {
    const track = { stop: () => { document.documentElement.dataset.micStopped = "true"; } };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) });
    class FailingRecorder { static isTypeSupported() { return true; } state = "inactive"; start() { throw new Error("Recorder failed to start"); } }
    Object.defineProperty(window, "MediaRecorder", { value: FailingRecorder });
  });
  await signIn(page, "+15550000001");
  await openChat(page, "Note to Self");
  const note = `Edit context ${Date.now()}`;
  await page.getByLabel("Message", { exact: true }).fill(note);
  await page.getByLabel("Message", { exact: true }).press("Enter");
  await expect(page.getByRole("article", { name: `You: ${note}`, exact: true })).toBeVisible();
  await page.locator(".chat-composer input[type=file]").first().setInputFiles({ name: "draft-notes.txt", mimeType: "text/plain", buffer: Buffer.from("A retained draft attachment") });
  await actions(page, `You: ${note}`, "Edit message");
  await page.getByRole("button", { name: "Cancel editing" }).click();
  await expect(page.locator(".chat-pending-files")).toContainText("draft-notes.txt");
  await openChat(page, "Priya Sharma");
  await openChat(page, "Note to Self");
  await expect(page.locator(".chat-pending-files")).toContainText("draft-notes.txt");
  await page.locator(".chat-pending-files").getByRole("button").click();
  await page.getByRole("button", { name: "Record a voice message" }).click();
  await expect(page.getByRole("region", { name: "Messages", exact: true }).getByRole("alert")).toContainText("Recorder failed to start");
  await expect(page.getByRole("button", { name: "Record a voice message" })).toBeEnabled();
  await expect(page.locator("html")).toHaveAttribute("data-mic-stopped", "true");
});
