import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import type { Conversation, Message } from "@/lib/types";
import { socket } from "@/lib/ws";
import { resetChat, useChat } from "@/stores/chat";

vi.mock("@/lib/ws", () => ({ socket: { send: vi.fn(() => false) } }));

const conversation = (id = 10): Conversation => ({
  id, type: "direct", name: "Bob", description: null, avatar_url: null, avatar_color: "A100",
  peer: null, member_count: 2, my_role: "member", is_member: true,
  disappearing_seconds: null, created_at: "2026-10-01T00:00:00Z", last_activity_at: "2026-10-01T00:00:00Z",
  last_message: null, unread_count: 0, mention_count: 0, last_read_message_id: null,
  is_pinned: false, is_archived: false, muted_until: null, marked_unread: false,
});
const message = (id: number, overrides: Partial<Message> = {}): Message => ({
  id, conversation_id: 10, sender_id: 2, client_id: `message-${id}`, type: "text", body: "Hello",
  meta: null, reply_to: null, is_forwarded: false, created_at: "2026-10-08T00:00:00Z",
  edited_at: null, is_deleted: false, expires_in_seconds: null, expires_at: null,
  attachments: [], reactions: [], mentions: [], status: null, ...overrides,
});

beforeEach(async () => {
  resetChat();
  vi.spyOn(api.messages, "delivered").mockResolvedValue(undefined);
  vi.spyOn(api.conversations, "list").mockResolvedValue([conversation()]);
  vi.spyOn(api.conversations, "messages").mockResolvedValue({ items: [], has_more_before: false, has_more_after: false });
  vi.spyOn(api.conversations, "send").mockImplementation(async (_id, input) => message(20, { ...input, sender_id: 1, status: "sent" }));
  await useChat.getState().init(1);
  await useChat.getState().loadLatest(10);
});
afterEach(() => { resetChat(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("chat delivery and recovery", () => {
  it("acknowledges received history and duplicate socket payloads without acknowledging own or system messages", async () => {
    vi.useFakeTimers();
    const incoming = message(11);
    vi.mocked(api.conversations.messages).mockResolvedValueOnce({
      items: [incoming, message(12, { sender_id: 1 }), message(13, { type: "system", sender_id: null })],
      has_more_before: false, has_more_after: false,
    });
    await useChat.getState().loadLatest(10);
    useChat.getState().handleEvent({ type: "message.new", data: incoming });
    useChat.getState().handleEvent({ type: "message.new", data: incoming });
    expect(api.messages.delivered).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(api.messages.delivered).toHaveBeenCalledExactlyOnceWith([11]);
  });

  it("retries delivery acknowledgements when the server temporarily cannot store them", async () => {
    vi.useFakeTimers();
    vi.mocked(api.messages.delivered).mockRejectedValueOnce(new Error("Offline"));
    useChat.getState().handleEvent({ type: "message.new", data: message(11) });
    await vi.advanceTimersByTimeAsync(150);
    expect(api.messages.delivered).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.messages.delivered).toHaveBeenCalledTimes(2);
    expect(api.messages.delivered).toHaveBeenLastCalledWith([11]);
  });

  it("does not retry a previous account's in-flight delivery acknowledgement after reset", async () => {
    vi.useFakeTimers();
    let fail!: (error: Error) => void;
    vi.mocked(api.messages.delivered).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    useChat.getState().handleEvent({ type: "message.new", data: message(11) });
    await vi.advanceTimersByTimeAsync(150);
    resetChat();
    await useChat.getState().init(2);
    fail(new Error("Late failure"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.messages.delivered).toHaveBeenCalledExactlyOnceWith([11]);
  });
  it("preserves pending sends and confirms them while viewing older search results", async () => {
    vi.mocked(socket.send).mockReturnValueOnce(true);
    await useChat.getState().send(10, { body: "Pending at latest" });
    const pending = useChat.getState().buckets[10].items[0];
    vi.mocked(api.conversations.messages).mockResolvedValueOnce({ items: [message(5)], has_more_before: true, has_more_after: true });
    await useChat.getState().jumpTo(10, 5);
    expect(useChat.getState().buckets[10].items.map((m) => m.id)).toEqual([5, pending.id]);
    useChat.getState().handleEvent({ type: "message.new", data: message(20, { sender_id: 1, client_id: pending.client_id, status: "sent" }) });
    expect(useChat.getState().buckets[10].items.map((m) => m.id)).toEqual([5, 20]);
    expect(useChat.getState().outbox).toEqual({});
  });

  it("keeps an acknowledgement that arrives while a search jump is loading", async () => {
    vi.mocked(socket.send).mockReturnValueOnce(true);
    await useChat.getState().send(10, { body: "Fast acknowledgement" });
    const pending = useChat.getState().buckets[10].items[0];
    let finish!: (value: Awaited<ReturnType<typeof api.conversations.messages>>) => void;
    vi.mocked(api.conversations.messages).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const jumping = useChat.getState().jumpTo(10, 5);
    useChat.getState().handleEvent({ type: "message.new", data: message(20, { sender_id: 1, client_id: pending.client_id, status: "sent" }) });
    finish({ items: [message(5)], has_more_before: true, has_more_after: true });
    await jumping;
    expect(useChat.getState().buckets[10].items.map((m) => m.id)).toEqual([5, 20]);
  });

  it("replaces local upload previews as soon as upload succeeds before the send acknowledgement", async () => {
    vi.mocked(socket.send).mockReturnValueOnce(true);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    vi.spyOn(api.attachments, "upload").mockResolvedValue({ id: 7, kind: "image", file_name: "photo.png", mime_type: "image/png", size_bytes: 5, width: 1, height: 1, duration_ms: null, url: "/api/attachments/7/file" });
    await useChat.getState().send(10, { body: "Photo", files: [new File(["photo"], "photo.png", { type: "image/png" })] });
    const pending = useChat.getState().buckets[10].items[0];
    expect(pending.status).toBe("sending");
    expect(pending.attachments).toHaveLength(1);
    expect(pending.localAttachments).toBeUndefined();
    expect(revoke).toHaveBeenCalledOnce();
  });

  it("reconciles duplicate deliveries without increasing unread counts twice", () => {
    const event = { type: "message.new" as const, data: message(11) };
    useChat.getState().handleEvent(event);
    useChat.getState().handleEvent(event);
    expect(useChat.getState().conversations[10].unread_count).toBe(1);
    expect(useChat.getState().buckets[10].items).toHaveLength(1);
  });

  it("keeps receipt status monotonic in bubbles and sidebar previews", () => {
    useChat.getState().handleEvent({ type: "message.new", data: message(11, { sender_id: 1, status: "sent" }) });
    for (const status of ["read", "delivered"] as const) {
      useChat.getState().handleEvent({ type: "receipt.updated", data: [{ message_id: 11, conversation_id: 10, status }] });
    }
    expect(useChat.getState().buckets[10].items[0].status).toBe("read");
    expect(useChat.getState().conversations[10].last_message?.status).toBe("read");
  });

  it("does not count a delivery again when a server summary already includes it", () => {
    const incoming = message(11);
    useChat.getState().upsertConversation({ ...conversation(), unread_count: 1, last_message: {
      id: 11, sender_id: 2, type: "text", body: incoming.body, meta: null,
      attachment_kind: null, created_at: incoming.created_at, is_deleted: false, status: null,
    } });
    useChat.getState().handleEvent({ type: "message.new", data: incoming });
    expect(useChat.getState().conversations[10].unread_count).toBe(1);
  });

  it("confirms a pending send while an initial timeline request is still loading", async () => {
    let finish!: (value: Awaited<ReturnType<typeof api.conversations.messages>>) => void;
    useChat.setState({ buckets: {} });
    vi.mocked(api.conversations.messages).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const loading = useChat.getState().loadLatest(10);
    vi.mocked(socket.send).mockReturnValueOnce(true);
    await useChat.getState().send(10, { body: "Fast send" });
    const pending = useChat.getState().buckets[10].items[0];
    useChat.getState().handleEvent({ type: "message.new", data: message(20, { sender_id: 1, client_id: pending.client_id, body: pending.body, status: "sent" }) });
    finish({ items: [message(11)], has_more_before: false, has_more_after: false });
    await loading;
    expect(useChat.getState().buckets[10].items.map((m) => m.id)).toEqual([11, 20]);
    expect(useChat.getState().buckets[10].items[1].status).toBe("sent");
  });

  it("clears queued entries when reconnect history recovers a lost acknowledgement", async () => {
    vi.mocked(socket.send).mockReturnValueOnce(true);
    await useChat.getState().send(10, { body: "Lost acknowledgement" });
    const pending = useChat.getState().buckets[10].items[0];
    vi.mocked(api.conversations.messages).mockResolvedValueOnce({ items: [message(20, { sender_id: 1, client_id: pending.client_id, status: "sent" })], has_more_before: false, has_more_after: false });
    await useChat.getState().loadLatest(10);
    expect(useChat.getState().outbox).toEqual({});
    expect(useChat.getState().buckets[10].items[0].id).toBe(20);
  });

  it("keeps real-time arrivals that race the latest page response", async () => {
    let finish!: (value: Awaited<ReturnType<typeof api.conversations.messages>>) => void;
    vi.mocked(api.conversations.messages).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const loading = useChat.getState().loadLatest(10);
    useChat.getState().handleEvent({ type: "message.new", data: message(12) });
    finish({ items: [message(11)], has_more_before: false, has_more_after: false });
    await loading;
    expect(useChat.getState().buckets[10].items.map((m) => m.id)).toEqual([11, 12]);
  });

  it("exposes loading failures and clears the error after a successful retry", async () => {
    vi.mocked(api.conversations.messages).mockRejectedValueOnce(new Error("Offline"));
    await useChat.getState().loadLatest(10);
    expect(useChat.getState().buckets[10].error).toBe("Offline");
    expect(useChat.getState().buckets[10].loading).toBe(false);
    await useChat.getState().loadLatest(10);
    expect(useChat.getState().buckets[10].error).toBeNull();
  });

  it("retries a failed attachment upload and then confirms the message", async () => {
    const upload = vi.spyOn(api.attachments, "upload").mockRejectedValueOnce(new Error("Offline"));
    upload.mockResolvedValue({ id: 7, kind: "file", file_name: "notes.txt", mime_type: "text/plain", size_bytes: 5, width: null, height: null, duration_ms: null, url: "/api/attachments/7/file" });
    await useChat.getState().send(10, { body: "File", files: [new File(["notes"], "notes.txt")] });
    const failed = useChat.getState().buckets[10].items[0];
    expect(failed.status).toBe("failed");
    useChat.getState().retry(failed.client_id!);
    await vi.waitFor(() => expect(useChat.getState().buckets[10].items[0].status).toBe("sent"));
    expect(upload).toHaveBeenCalledTimes(2);
    expect(api.conversations.send).toHaveBeenCalledWith(10, expect.objectContaining({ attachment_ids: [7] }));
    expect(useChat.getState().buckets[10].items).toHaveLength(1);
  });

  it("marks an offline REST send failed so the user can retry it", async () => {
    vi.mocked(api.conversations.send).mockRejectedValueOnce(new Error("Offline"));
    await useChat.getState().send(10, { body: "Can you see this?" });
    await vi.waitFor(() => expect(useChat.getState().buckets[10].items[0].status).toBe("failed"));
    expect(Object.values(useChat.getState().outbox)).toHaveLength(1);
    useChat.getState().retry(useChat.getState().buckets[10].items[0].client_id!);
    await vi.waitFor(() => expect(useChat.getState().buckets[10].items[0].status).toBe("sent"));
    expect(Object.values(useChat.getState().outbox)).toHaveLength(0);
  });

  it("restores unread counts when a REST read receipt fails", async () => {
    useChat.getState().handleEvent({ type: "message.new", data: message(11) });
    vi.spyOn(api.conversations, "markRead").mockRejectedValueOnce(new Error("Offline"));
    useChat.getState().markRead(10);
    await vi.waitFor(() => expect(useChat.getState().conversations[10].unread_count).toBe(1));
    expect(useChat.getState().conversations[10].last_read_message_id).toBeNull();
  });

  it("clears account data, outbox, and timers on reset", async () => {
    vi.mocked(socket.send).mockReturnValueOnce(true);
    await useChat.getState().send(10, { body: "Pending" });
    resetChat();
    expect(useChat.getState().meId).toBeNull();
    expect(useChat.getState().conversations).toEqual({});
    expect(useChat.getState().buckets).toEqual({});
    expect(useChat.getState().outbox).toEqual({});
  });
});
