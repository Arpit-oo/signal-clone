import { create } from "zustand";

import { api, ApiError } from "@/lib/api";
import type {
  Attachment,
  ChatMessage,
  Conversation,
  ConversationDetail,
  LocalAttachment,
  LocalStatus,
  Message,
  MessageStatus,
  ServerEvent,
  User,
} from "@/lib/types";
import { socket } from "@/lib/ws";

interface MessageBucket {
  items: ChatMessage[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  loading: boolean;
  loaded: boolean;
}

interface Presence {
  online: boolean;
  last_seen_at: string | null;
}

interface OutboxEntry {
  conversation_id: number;
  client_id: string;
  body: string;
  reply_to_id: number | null;
  attachment_ids: number[];
  mentions: number[];
}

export interface SendInput {
  body: string;
  replyTo?: ChatMessage | null;
  files?: File[];
  voice?: { blob: Blob; durationMs: number } | null;
  mentions?: number[];
}

interface ChatState {
  meId: number | null;
  conversations: Record<number, Conversation>;
  conversationsLoaded: boolean;
  details: Record<number, ConversationDetail>;
  users: Record<number, User>;
  buckets: Record<number, MessageBucket>;
  typing: Record<number, number[]>;
  presence: Record<number, Presence>;
  outbox: Record<string, OutboxEntry>;
  /** Message to scroll to and flash (reply jumps, search results). */
  focusMessage: { conversationId: number; messageId: number; nonce: number } | null;

  init: (meId: number) => Promise<void>;
  loadConversations: () => Promise<void>;
  upsertConversation: (c: Conversation) => void;
  removeConversation: (id: number) => void;
  loadDetail: (id: number) => Promise<ConversationDetail | null>;
  rememberUsers: (users: User[]) => void;

  loadLatest: (id: number) => Promise<void>;
  loadOlder: (id: number) => Promise<void>;
  loadNewer: (id: number) => Promise<void>;
  jumpTo: (id: number, messageId: number) => Promise<void>;

  send: (conversationId: number, input: SendInput) => Promise<void>;
  retry: (clientId: string) => void;
  discardFailed: (conversationId: number, clientId: string) => void;
  flushOutbox: () => void;
  markRead: (conversationId: number) => void;

  handleEvent: (event: ServerEvent) => void;
}

const emptyBucket = (): MessageBucket => ({
  items: [],
  hasMoreBefore: true,
  hasMoreAfter: false,
  loading: false,
  loaded: false,
});

const STATUS_RANK: Record<LocalStatus, number> = {
  failed: -1,
  sending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

/** Receipts can arrive out of order; never move a tick backwards. */
function maxStatus(a: LocalStatus | null, b: MessageStatus | null): LocalStatus | null {
  if (!b) return a;
  if (!a) return b;
  return STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
}

function sortItems(items: ChatMessage[]): ChatMessage[] {
  // Confirmed messages by id, then pending ones (negative temp ids) in send order.
  return [...items].sort((x, y) => {
    if (x.id > 0 && y.id > 0) return x.id - y.id;
    if (x.id > 0) return -1;
    if (y.id > 0) return 1;
    return y.id - x.id;
  });
}

function mergeMessages(existing: ChatMessage[], incoming: Message[]): ChatMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  const pendingByClient = new Map(
    existing.filter((m) => m.id < 0 && m.client_id).map((m) => [m.client_id!, m]),
  );
  for (const m of incoming) {
    const prev = byId.get(m.id);
    if (m.client_id && pendingByClient.has(m.client_id)) {
      const pending = pendingByClient.get(m.client_id)!;
      byId.delete(pending.id);
    }
    byId.set(m.id, { ...m, status: maxStatus(prev?.status ?? null, m.status) });
  }
  return sortItems([...byId.values()]);
}

function previewFrom(m: Message | ChatMessage): Conversation["last_message"] {
  return {
    id: m.id,
    sender_id: m.sender_id,
    type: m.type,
    body: m.body,
    meta: m.meta,
    attachment_kind: m.attachments[0]?.kind ?? null,
    created_at: m.created_at,
    is_deleted: m.is_deleted,
    status: (m.status === "sending" || m.status === "failed" ? null : m.status) as MessageStatus | null,
  };
}

function isMuted(c: Conversation): boolean {
  return !!c.muted_until && new Date(c.muted_until).getTime() > Date.now();
}

let deliveredQueue: number[] = [];
let deliveredTimer: ReturnType<typeof setTimeout> | null = null;
function queueDelivered(id: number) {
  deliveredQueue.push(id);
  if (deliveredTimer) return;
  deliveredTimer = setTimeout(() => {
    const ids = deliveredQueue;
    deliveredQueue = [];
    deliveredTimer = null;
    socket.send("receipt.delivered", { message_ids: ids });
  }, 150);
}

let tempId = -1;
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useChat = create<ChatState>()((set, get) => {
  function patchBucket(id: number, fn: (b: MessageBucket) => Partial<MessageBucket>) {
    set((s) => {
      const b = s.buckets[id] ?? emptyBucket();
      return { buckets: { ...s.buckets, [id]: { ...b, ...fn(b) } } };
    });
  }

  function patchConversation(id: number, fn: (c: Conversation) => Partial<Conversation>) {
    set((s) => {
      const c = s.conversations[id];
      if (!c) return {};
      return { conversations: { ...s.conversations, [id]: { ...c, ...fn(c) } } };
    });
  }

  function patchMessage(conversationId: number, match: (m: ChatMessage) => boolean, fn: (m: ChatMessage) => Partial<ChatMessage>) {
    patchBucket(conversationId, (b) => ({
      items: b.items.map((m) => (match(m) ? { ...m, ...fn(m) } : m)),
    }));
  }

  async function ensureConversation(id: number) {
    if (get().conversations[id]) return;
    try {
      const detail = await api.conversations.get(id);
      get().upsertConversation(detail);
      set((s) => ({ details: { ...s.details, [id]: detail } }));
      get().rememberUsers(detail.members.map((m) => m.user));
    } catch {
      // Not visible to us (e.g. removed); ignore.
    }
  }

  function applyIncoming(msg: Message) {
    const { meId } = get();
    const bucket = get().buckets[msg.conversation_id];
    if (bucket?.loaded && !bucket.hasMoreAfter) {
      patchBucket(msg.conversation_id, (b) => ({ items: mergeMessages(b.items, [msg]) }));
    }
    if (msg.client_id) {
      set((s) => {
        if (!s.outbox[msg.client_id!]) return {};
        const { [msg.client_id!]: _, ...rest } = s.outbox;
        return { outbox: rest };
      });
    }
    const conv = get().conversations[msg.conversation_id];
    if (!conv) {
      void ensureConversation(msg.conversation_id);
      return;
    }
    const fromOther = msg.sender_id !== meId;
    const counts = fromOther && msg.type === "text";
    patchConversation(msg.conversation_id, (c) => ({
      last_message: !c.last_message || msg.id >= c.last_message.id ? previewFrom(msg) : c.last_message,
      last_activity_at: msg.created_at > c.last_activity_at ? msg.created_at : c.last_activity_at,
      unread_count: counts ? c.unread_count + 1 : c.unread_count,
      mention_count: counts && meId && msg.mentions.includes(meId) ? c.mention_count + 1 : c.mention_count,
      last_read_message_id: fromOther ? c.last_read_message_id : msg.id,
      is_archived: c.is_archived && isMuted(c),
      marked_unread: fromOther ? c.marked_unread : false,
    }));
    if (fromOther && msg.type === "text") queueDelivered(msg.id);
    // Remove the sender's typing bubble as soon as their message lands.
    if (msg.sender_id) setTyping(msg.conversation_id, msg.sender_id, false);
  }

  function setTyping(conversationId: number, userId: number, isTyping: boolean) {
    const key = `${conversationId}:${userId}`;
    const timer = typingTimers.get(key);
    if (timer) clearTimeout(timer);
    typingTimers.delete(key);
    if (isTyping) {
      // Safety net in case the stop event is lost.
      typingTimers.set(key, setTimeout(() => setTyping(conversationId, userId, false), 8000));
    }
    set((s) => {
      const current = s.typing[conversationId] ?? [];
      const next = isTyping
        ? current.includes(userId)
          ? current
          : [...current, userId]
        : current.filter((u) => u !== userId);
      if (next === current) return {};
      return { typing: { ...s.typing, [conversationId]: next } };
    });
  }

  function dispatch(entry: OutboxEntry) {
    const sent = socket.send("message.send", entry);
    if (sent) return;
    // Socket is down: fall back to REST so the message still goes out.
    api.conversations
      .send(entry.conversation_id, entry)
      .then((m) => applyIncoming(m))
      .catch((err) => {
        // Network failures stay queued for the reconnect flush; rejections fail the bubble.
        if (err instanceof ApiError && err.status > 0) failMessage(entry, err.message);
      });
  }

  function failMessage(entry: OutboxEntry, _reason: string) {
    patchMessage(entry.conversation_id, (m) => m.client_id === entry.client_id, () => ({ status: "failed" }));
  }

  return {
    meId: null,
    conversations: {},
    conversationsLoaded: false,
    details: {},
    users: {},
    buckets: {},
    typing: {},
    presence: {},
    outbox: {},
    focusMessage: null,

    init: async (meId) => {
      set({ meId });
      await get().loadConversations();
    },

    loadConversations: async () => {
      const list = await api.conversations.list();
      const conversations: Record<number, Conversation> = {};
      for (const c of list) conversations[c.id] = c;
      set({ conversations, conversationsLoaded: true });
      get().rememberUsers(list.flatMap((c) => (c.peer ? [c.peer] : [])));
    },

    upsertConversation: (c) => {
      const { members: _members, ...plain } = c as ConversationDetail;
      set((s) => ({ conversations: { ...s.conversations, [c.id]: plain } }));
      if (c.peer) get().rememberUsers([c.peer]);
    },

    removeConversation: (id) =>
      set((s) => {
        const { [id]: _c, ...conversations } = s.conversations;
        const { [id]: _b, ...buckets } = s.buckets;
        return { conversations, buckets };
      }),

    loadDetail: async (id) => {
      try {
        const detail = await api.conversations.get(id);
        set((s) => ({ details: { ...s.details, [id]: detail } }));
        get().upsertConversation(detail);
        get().rememberUsers(detail.members.map((m) => m.user));
        return detail;
      } catch {
        return null;
      }
    },

    rememberUsers: (users) =>
      set((s) => {
        if (!users.length) return {};
        const next = { ...s.users };
        const presence = { ...s.presence };
        for (const u of users) {
          next[u.id] = { ...next[u.id], ...u };
          if (!presence[u.id]) presence[u.id] = { online: u.is_online, last_seen_at: u.last_seen_at };
        }
        return { users: next, presence };
      }),

    loadLatest: async (id) => {
      const b = get().buckets[id];
      if (b?.loading) return;
      patchBucket(id, () => ({ loading: true }));
      try {
        const page = await api.conversations.messages(id, { limit: 50 });
        patchBucket(id, (cur) => ({
          // Keep pending sends that haven't been acked yet.
          items: mergeMessages(cur.items.filter((m) => m.id < 0), page.items),
          hasMoreBefore: page.has_more_before,
          hasMoreAfter: false,
          loaded: true,
          loading: false,
        }));
      } catch {
        patchBucket(id, () => ({ loading: false }));
      }
    },

    loadOlder: async (id) => {
      const b = get().buckets[id];
      if (!b || b.loading || !b.hasMoreBefore) return;
      const first = b.items.find((m) => m.id > 0);
      if (!first) return;
      patchBucket(id, () => ({ loading: true }));
      try {
        const page = await api.conversations.messages(id, { before: first.id, limit: 50 });
        patchBucket(id, (cur) => ({
          items: mergeMessages(cur.items, page.items),
          hasMoreBefore: page.has_more_before,
          loading: false,
        }));
      } catch {
        patchBucket(id, () => ({ loading: false }));
      }
    },

    loadNewer: async (id) => {
      const b = get().buckets[id];
      if (!b || b.loading || !b.hasMoreAfter) return;
      const confirmed = b.items.filter((m) => m.id > 0);
      const last = confirmed[confirmed.length - 1];
      if (!last) return;
      patchBucket(id, () => ({ loading: true }));
      try {
        const page = await api.conversations.messages(id, { after: last.id, limit: 50 });
        patchBucket(id, (cur) => ({
          items: mergeMessages(cur.items, page.items),
          hasMoreAfter: page.has_more_after,
          loading: false,
        }));
      } catch {
        patchBucket(id, () => ({ loading: false }));
      }
    },

    jumpTo: async (id, messageId) => {
      const b = get().buckets[id];
      if (!b?.items.some((m) => m.id === messageId)) {
        patchBucket(id, () => ({ loading: true }));
        try {
          const page = await api.conversations.messages(id, { around: messageId, limit: 60 });
          patchBucket(id, () => ({
            items: page.items.map((m) => ({ ...m })),
            hasMoreBefore: page.has_more_before,
            hasMoreAfter: page.has_more_after,
            loaded: true,
            loading: false,
          }));
        } catch {
          patchBucket(id, () => ({ loading: false }));
          return;
        }
      }
      set({ focusMessage: { conversationId: id, messageId, nonce: Date.now() } });
    },

    send: async (conversationId, input) => {
      const { meId } = get();
      if (!meId) return;
      const clientId = crypto.randomUUID();
      const id = tempId--;
      const files = input.files ?? [];
      const locals: LocalAttachment[] = files.map((f) => ({
        name: f.name,
        kind: f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : "file",
        previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
        size: f.size,
      }));
      if (input.voice) locals.push({ name: "Voice message", kind: "voice", previewUrl: null, size: input.voice.blob.size });

      const conv = get().conversations[conversationId];
      const optimistic: ChatMessage = {
        id,
        conversation_id: conversationId,
        sender_id: meId,
        client_id: clientId,
        type: "text",
        body: input.body,
        meta: null,
        reply_to: input.replyTo
          ? {
              id: input.replyTo.id,
              sender_id: input.replyTo.sender_id,
              body: input.replyTo.body,
              attachment_kind: input.replyTo.attachments[0]?.kind ?? null,
              is_deleted: false,
            }
          : null,
        is_forwarded: false,
        created_at: new Date().toISOString(),
        edited_at: null,
        is_deleted: false,
        expires_in_seconds: conv?.disappearing_seconds ?? null,
        expires_at: null,
        attachments: [],
        reactions: [],
        mentions: input.mentions ?? [],
        status: "sending",
        localAttachments: locals,
      };
      patchBucket(conversationId, (b) => ({ items: sortItems([...b.items, optimistic]) }));
      patchConversation(conversationId, () => ({
        last_message: previewFrom(optimistic),
        last_activity_at: optimistic.created_at,
        is_archived: false,
        marked_unread: false,
      }));

      let uploaded: Attachment[] = [];
      try {
        uploaded = await Promise.all([
          ...files.map((f) => api.attachments.upload(f, { name: f.name })),
          ...(input.voice
            ? [api.attachments.upload(input.voice.blob, { voice: true, durationMs: input.voice.durationMs, name: "voice-message.webm" })]
            : []),
        ]);
      } catch {
        patchMessage(conversationId, (m) => m.id === id, () => ({ status: "failed" }));
        return;
      }

      const entry: OutboxEntry = {
        conversation_id: conversationId,
        client_id: clientId,
        body: input.body,
        reply_to_id: input.replyTo?.id ?? null,
        attachment_ids: uploaded.map((a) => a.id),
        mentions: input.mentions ?? [],
      };
      set((s) => ({ outbox: { ...s.outbox, [clientId]: entry } }));
      dispatch(entry);
    },

    retry: (clientId) => {
      const entry = get().outbox[clientId];
      if (!entry) return;
      patchMessage(entry.conversation_id, (m) => m.client_id === clientId, () => ({ status: "sending" }));
      dispatch(entry);
    },

    discardFailed: (conversationId, clientId) => {
      patchBucket(conversationId, (b) => ({ items: b.items.filter((m) => m.client_id !== clientId) }));
      set((s) => {
        const { [clientId]: _, ...rest } = s.outbox;
        return { outbox: rest };
      });
    },

    flushOutbox: () => {
      for (const entry of Object.values(get().outbox)) {
        const pending = get().buckets[entry.conversation_id]?.items.find((m) => m.client_id === entry.client_id);
        if (pending?.status === "sending") dispatch(entry);
      }
    },

    markRead: (conversationId) => {
      const c = get().conversations[conversationId];
      const b = get().buckets[conversationId];
      if (!c || !b?.loaded || b.hasMoreAfter) return;
      const confirmed = b.items.filter((m) => m.id > 0);
      const last = confirmed[confirmed.length - 1];
      if (!last) return;
      const needs =
        c.unread_count > 0 || c.marked_unread || (c.last_read_message_id ?? 0) < last.id;
      if (!needs) return;
      patchConversation(conversationId, () => ({
        unread_count: 0,
        mention_count: 0,
        marked_unread: false,
        last_read_message_id: last.id,
      }));
      if (!socket.send("receipt.read", { conversation_id: conversationId, up_to_id: last.id })) {
        void api.conversations.markRead(conversationId, last.id).catch(() => {});
      }
    },

    handleEvent: (event) => {
      switch (event.type) {
        case "message.new":
          applyIncoming(event.data);
          break;

        case "message.updated": {
          const msg = event.data;
          patchMessage(msg.conversation_id, (m) => m.id === msg.id, (m) => ({
            ...msg,
            status: maxStatus(m.status, msg.status),
          }));
          patchConversation(msg.conversation_id, (c) =>
            c.last_message?.id === msg.id ? { last_message: previewFrom(msg) } : {},
          );
          break;
        }

        case "message.hidden":
        case "message.expired": {
          const ids = event.type === "message.hidden" ? [event.data.message_id] : event.data.message_ids;
          const convId = event.data.conversation_id;
          patchBucket(convId, (b) => ({ items: b.items.filter((m) => !ids.includes(m.id)) }));
          const c = get().conversations[convId];
          if (c?.last_message && ids.includes(c.last_message.id)) {
            void api.conversations.get(convId).then((d) => get().upsertConversation(d)).catch(() => {});
          }
          break;
        }

        case "message.timer_started":
          for (const t of event.data) {
            patchMessage(t.conversation_id, (m) => m.id === t.id, () => ({ expires_at: t.expires_at }));
          }
          break;

        case "reaction.updated": {
          const { message_id, conversation_id, reactions } = event.data;
          patchMessage(conversation_id, (m) => m.id === message_id, () => ({ reactions }));
          break;
        }

        case "receipt.updated":
          for (const r of event.data) {
            patchMessage(r.conversation_id, (m) => m.id === r.message_id, (m) => ({
              status: maxStatus(m.status, r.status),
            }));
            patchConversation(r.conversation_id, (c) =>
              c.last_message?.id === r.message_id
                ? { last_message: { ...c.last_message, status: r.status } }
                : {},
            );
          }
          break;

        case "typing":
          setTyping(event.data.conversation_id, event.data.user_id, event.data.is_typing);
          break;

        case "presence":
          set((s) => ({
            presence: {
              ...s.presence,
              [event.data.user_id]: { online: event.data.online, last_seen_at: event.data.last_seen_at },
            },
          }));
          break;

        case "user.updated": {
          const u = event.data;
          set((s) => {
            const prev = s.users[u.id];
            const users = prev ? { ...s.users, [u.id]: { ...prev, ...u } } : s.users;
            const conversations = { ...s.conversations };
            for (const c of Object.values(conversations)) {
              if (c.peer?.id === u.id) {
                const peer = { ...c.peer, ...u };
                conversations[c.id] = {
                  ...c,
                  peer,
                  name: peer.nickname || peer.display_name || peer.phone,
                  avatar_url: peer.avatar_url,
                  avatar_color: peer.avatar_color,
                };
              }
            }
            return { users, conversations };
          });
          break;
        }

        case "conversation.updated":
          get().upsertConversation(event.data);
          if (get().details[event.data.id]) void get().loadDetail(event.data.id);
          break;

        case "conversation.read":
          patchConversation(event.data.conversation_id, () => ({
            unread_count: 0,
            mention_count: 0,
            marked_unread: false,
            last_read_message_id: event.data.last_read_message_id,
          }));
          break;

        case "conversation.removed":
          get().removeConversation(event.data.conversation_id);
          break;

        case "error": {
          const clientId = event.data.ref?.client_id;
          if (typeof clientId === "string") {
            const entry = get().outbox[clientId];
            if (entry) failMessage(entry, event.data.detail);
          }
          break;
        }

        default:
          break;
      }
    },
  };
});

// --- typing (outgoing) ----------------------------------------------------------------------

let typingConv: number | null = null;
let typingLastSent = 0;
let typingStopTimer: ReturnType<typeof setTimeout> | null = null;

/** Call on each keystroke; sends typing.start at most every 3s and stops after 3s idle. */
export function notifyTyping(conversationId: number) {
  const now = Date.now();
  if (typingConv !== conversationId || now - typingLastSent > 3000) {
    if (typingConv !== null && typingConv !== conversationId) stopTyping();
    socket.send("typing.start", { conversation_id: conversationId });
    typingConv = conversationId;
    typingLastSent = now;
  }
  if (typingStopTimer) clearTimeout(typingStopTimer);
  typingStopTimer = setTimeout(stopTyping, 3000);
}

export function stopTyping() {
  if (typingStopTimer) clearTimeout(typingStopTimer);
  typingStopTimer = null;
  if (typingConv !== null) socket.send("typing.stop", { conversation_id: typingConv });
  typingConv = null;
  typingLastSent = 0;
}

// --- selectors ------------------------------------------------------------------------------

export function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    return b.last_activity_at.localeCompare(a.last_activity_at);
  });
}

export function isConversationMuted(c: Conversation): boolean {
  return isMuted(c);
}

export function displayName(u: Pick<User, "nickname" | "display_name" | "phone"> | undefined | null): string {
  if (!u) return "Unknown";
  return u.nickname || u.display_name || u.phone;
}
