import { describe, expect, it } from "vitest";
import { MessageAlerts } from "@/lib/message-alerts";
import type { Conversation, Message } from "@/lib/types";

const message: Message = {
  id: 20,
  conversation_id: 10,
  sender_id: 2,
  client_id: "incoming",
  type: "text",
  body: "Hello",
  meta: null,
  reply_to: null,
  is_forwarded: false,
  created_at: "2026-10-09T00:00:00Z",
  edited_at: null,
  is_deleted: false,
  expires_in_seconds: null,
  expires_at: null,
  attachments: [],
  reactions: [],
  mentions: [],
  status: null,
};
const context = {
  userId: 1,
  conversation: {
    name: "Priya",
    muted_until: null,
    last_read_message_id: null,
  } as unknown as Conversation,
  pathname: "/stories",
  background: false,
  inCall: false,
  prefs: {
    notificationsEnabled: true,
    notificationSound: true,
    notificationContent: "name_and_message" as const,
  },
};

describe("message notification policy", () => {
  it("chimes for a live message outside the open chat without desktop permission", () => {
    const alert = new MessageAlerts().receive(message, context);
    expect(alert).toMatchObject({
      sound: true,
      desktop: false,
      title: "Priya",
      body: "Hello",
    });
  });
  it("keeps the focused open conversation quiet but alerts when it is in the background", () => {
    expect(
      new MessageAlerts().receive(message, {
        ...context,
        pathname: "/chats/10",
      }),
    ).toBeNull();
    expect(
      new MessageAlerts().receive(message, {
        ...context,
        pathname: "/chats/10",
        background: true,
      }),
    ).toMatchObject({ sound: true, desktop: true });
  });
  it("honors independent sound/desktop preferences and suppresses chimes during calls", () => {
    expect(
      new MessageAlerts().receive(message, {
        ...context,
        background: true,
        prefs: { ...context.prefs, notificationSound: false },
      }),
    ).toMatchObject({ sound: false, desktop: true });
    expect(
      new MessageAlerts().receive(message, {
        ...context,
        background: true,
        prefs: { ...context.prefs, notificationsEnabled: false },
      }),
    ).toMatchObject({ sound: true, desktop: false });
    expect(
      new MessageAlerts().receive(message, { ...context, inCall: true }),
    ).toMatchObject({ sound: false });
  });
  it("respects privacy choices for message and attachment previews", () => {
    expect(
      new MessageAlerts().receive(message, {
        ...context,
        prefs: { ...context.prefs, notificationContent: "none" },
      }),
    ).toMatchObject({ title: "New message", body: "" });
    expect(
      new MessageAlerts().receive(message, {
        ...context,
        prefs: { ...context.prefs, notificationContent: "name" },
      }),
    ).toMatchObject({ title: "Priya", body: "" });
    expect(
      new MessageAlerts().receive({ ...message, body: "" }, context),
    ).toMatchObject({ body: "Attachment" });
  });
  it("never alerts on own, system, deleted, expired, read or muted messages", () => {
    for (const patch of [
      { sender_id: 1 },
      { type: "system" as const },
      { is_deleted: true },
      { expires_at: "2000-01-01T00:00:00Z" },
    ]) {
      expect(
        new MessageAlerts().receive({ ...message, ...patch }, context),
      ).toBeNull();
    }
    for (const patch of [
      { muted_until: "2999-01-01T00:00:00Z" },
      { last_read_message_id: 20 },
    ]) {
      expect(
        new MessageAlerts().receive(message, {
          ...context,
          conversation: { ...context.conversation, ...patch },
        }),
      ).toBeNull();
    }
    expect(
      new MessageAlerts().receive(message, {
        ...context,
        conversation: {
          ...context.conversation,
          muted_until: "2000-01-01T00:00:00Z",
        },
      }),
    ).toMatchObject({ sound: true });
  });
  it("deduplicates socket delivery and resets its memory for a different account", () => {
    const alerts = new MessageAlerts();
    expect(alerts.receive(message, context)).not.toBeNull();
    expect(
      alerts.receive(message, { ...context, background: true }),
    ).toBeNull();
    expect(alerts.receive(message, { ...context, userId: 3 })).not.toBeNull();
  });
});
