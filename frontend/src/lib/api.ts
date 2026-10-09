import type {
  Attachment,
  Conversation,
  ConversationDetail,
  GroupInCommon,
  Me,
  Message,
  MessageInfo,
  MessagePage,
  SearchResults,
  Story,
  StoryView,
  User,
} from "./types";

const TOKEN_KEY = "signal-token";
let memoryToken: string | null = null;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return memoryToken ?? localStorage.getItem(TOKEN_KEY);
  } catch {
    return memoryToken;
  }
}

export function setToken(token: string | null) {
  memoryToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode); the session just won't persist.
  }
}

/** Appends the auth token so <img>/<audio> elements can load protected files. */
export function fileUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/api/media/") || url.startsWith("/api/demo-avatars/")) return url;
  const token = getToken();
  return token
    ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
    : url;
}

function detailOf(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    // FastAPI validation errors: [{msg: "..."}]
    if (Array.isArray(detail) && detail[0]?.msg) {
      return String(detail[0].msg).replace(/^Value error, /, "");
    }
  }
  return fallback;
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }
  if (res.status === 401 && token) onUnauthorized?.();
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok)
    throw new ApiError(
      res.status,
      detailOf(data, `Request failed (${res.status})`),
    );
  return data as T;
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body?: unknown) =>
  request<T>("POST", path, body);
const patch = <T>(path: string, body?: unknown) =>
  request<T>("PATCH", path, body);
const put = <T>(path: string, body?: unknown) => request<T>("PUT", path, body);
const del = <T>(path: string) => request<T>("DELETE", path);

const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null) s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
};

function upload<T>(
  path: string,
  file: Blob,
  fields: Record<string, string> = {},
  name?: string,
) {
  const form = new FormData();
  form.append(
    "file",
    file,
    name ?? (file instanceof File ? file.name : "file"),
  );
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return post<T>(path, form);
}

export const api = {
  auth: {
    requestOtp: (phone: string, countryCode = "+91") =>
      post<{ phone: string; dev_code: string }>("/auth/request-otp", {
        phone,
        country_code: countryCode,
      }),
    verify: (phone: string, code: string) =>
      post<{ token: string; user: Me; is_new: boolean }>("/auth/verify", {
        phone,
        code,
      }),
  },
  me: {
    get: () => get<Me>("/me"),
    update: (data: Partial<Me>) => patch<Me>("/me", data),
    uploadAvatar: (file: Blob) =>
      upload<Me>("/me/avatar", file, {}, "avatar.jpg"),
    deleteAvatar: () => del<Me>("/me/avatar"),
  },
  users: {
    search: (q: string) => get<User[]>(`/users/search${qs({ q })}`),
    lookup: (params: { phone?: string; username?: string }) =>
      get<User>(`/users/lookup${qs(params)}`),
    get: (id: number) => get<User>(`/users/${id}`),
    groupsInCommon: (id: number) =>
      get<GroupInCommon[]>(`/users/${id}/groups-in-common`),
  },
  contacts: {
    list: () => get<User[]>("/contacts"),
    add: (data: {
      user_id?: number;
      phone?: string;
      username?: string;
      nickname?: string;
    }) => post<User>("/contacts", data),
    rename: (userId: number, nickname: string | null) =>
      patch<User>(`/contacts/${userId}`, { nickname }),
    remove: (userId: number) => del<void>(`/contacts/${userId}`),
  },
  blocks: {
    list: () => get<User[]>("/blocks"),
    block: (userId: number) => put<User>(`/blocks/${userId}`),
    unblock: (userId: number) => del<void>(`/blocks/${userId}`),
  },
  conversations: {
    list: () => get<Conversation[]>("/conversations"),
    get: (id: number) => get<ConversationDetail>(`/conversations/${id}`),
    createDirect: (userId: number) =>
      post<Conversation>("/conversations", {
        type: "direct",
        member_ids: [userId],
      }),
    createGroup: (data: {
      name: string;
      member_ids: number[];
      avatar_color?: string;
      description?: string;
    }) => post<Conversation>("/conversations", { type: "group", ...data }),
    update: (
      id: number,
      data: {
        name?: string;
        description?: string | null;
        avatar_color?: string;
        disappearing_seconds?: number | null;
      },
    ) => patch<ConversationDetail>(`/conversations/${id}`, data),
    uploadAvatar: (id: number, file: Blob) =>
      upload<ConversationDetail>(
        `/conversations/${id}/avatar`,
        file,
        {},
        "avatar.jpg",
      ),
    deleteAvatar: (id: number) =>
      del<ConversationDetail>(`/conversations/${id}/avatar`),
    settings: (
      id: number,
      data: {
        is_pinned?: boolean;
        is_archived?: boolean;
        marked_unread?: boolean;
        mute_seconds?: number;
        wallpaper?: string | null;
      },
    ) => patch<Conversation>(`/conversations/${id}/settings`, data),
    uploadWallpaper: (id: number, file: File) =>
      upload<Conversation>(`/conversations/${id}/wallpaper`, file, {}, file.name),
    remove: (id: number) => del<void>(`/conversations/${id}`),
    addMembers: (id: number, userIds: number[]) =>
      post<ConversationDetail>(`/conversations/${id}/members`, {
        user_ids: userIds,
      }),
    removeMember: (id: number, userId: number) =>
      del<ConversationDetail>(`/conversations/${id}/members/${userId}`),
    setRole: (id: number, userId: number, role: "admin" | "member") =>
      patch<ConversationDetail>(`/conversations/${id}/members/${userId}`, {
        role,
      }),
    leave: (id: number) => post<Conversation>(`/conversations/${id}/leave`),
    messages: (
      id: number,
      params: {
        before?: number;
        after?: number;
        around?: number;
        limit?: number;
      } = {},
    ) => get<MessagePage>(`/conversations/${id}/messages${qs(params)}`),
    searchMessages: (id: number, q: string) =>
      get<Message[]>(`/conversations/${id}/messages/search${qs({ q })}`),
    markRead: (id: number, upToId: number) =>
      post<void>(`/conversations/${id}/read`, { up_to_id: upToId }),
    send: (
      id: number,
      data: {
        client_id: string;
        body: string;
        reply_to_id?: number | null;
        attachment_ids?: number[];
        mentions?: number[];
      },
    ) => post<Message>(`/conversations/${id}/messages`, data),
  },
  messages: {
    delivered: (messageIds: number[]) =>
      post<void>("/messages/delivered", { message_ids: messageIds }),
    info: (id: number) => get<MessageInfo>(`/messages/${id}/info`),
    edit: (id: number, body: string) =>
      patch<Message>(`/messages/${id}`, { body }),
    remove: (id: number, scope: "me" | "everyone") =>
      del<void>(`/messages/${id}${qs({ scope })}`),
    react: (id: number, emoji: string) =>
      put<void>(`/messages/${id}/reaction`, { emoji }),
    unreact: (id: number) => del<void>(`/messages/${id}/reaction`),
    forward: (id: number, conversationIds: number[], note?: string) =>
      post<Message[]>(`/messages/${id}/forward`, {
        conversation_ids: conversationIds,
        note,
      }),
  },
  attachments: {
    upload: (
      file: Blob,
      opts: { voice?: boolean; durationMs?: number; name?: string } = {},
    ) =>
      upload<Attachment>(
        "/attachments",
        file,
        {
          ...(opts.voice ? { voice: "true" } : {}),
          ...(opts.durationMs
            ? { duration_ms: String(Math.round(opts.durationMs)) }
            : {}),
        },
        opts.name,
      ),
  },
  stories: {
    list: () => get<Story[]>("/stories"),
    create: (data: {
      body: string;
      color: string;
      recipient_ids: number[];
      file?: File;
    }) => {
      const form = new FormData();
      form.append("body", data.body);
      form.append("color", data.color);
      form.append("recipient_ids", JSON.stringify(data.recipient_ids));
      if (data.file) form.append("file", data.file);
      return post<Story>("/stories", form);
    },
    view: (id: number) => post<void>(`/stories/${id}/views`),
    views: (id: number) => get<StoryView[]>(`/stories/${id}/views`),
    remove: (id: number) => del<void>(`/stories/${id}`),
  },
  search: (q: string) => get<SearchResults>(`/search${qs({ q })}`),
};
