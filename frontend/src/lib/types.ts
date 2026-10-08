// Mirrors the backend's Pydantic schemas (backend/app/schemas).

export type AvatarColor =
  | "A100"
  | "A110"
  | "A120"
  | "A130"
  | "A140"
  | "A150"
  | "A160"
  | "A170"
  | "A180"
  | "A190"
  | "A200"
  | "A210";

export interface User {
  id: number;
  phone: string;
  username: string | null;
  display_name: string;
  about: string;
  about_emoji: string | null;
  avatar_url: string | null;
  avatar_color: AvatarColor;
  last_seen_at: string | null;
  is_online: boolean;
  is_contact: boolean;
  is_blocked: boolean;
  nickname: string | null;
}

export interface Me extends User {
  read_receipts_enabled: boolean;
  typing_indicators_enabled: boolean;
  created_at: string;
}

export type MessageStatus = "sent" | "delivered" | "read";
/** Client-only states layered on top of the server's statuses. */
export type LocalStatus = MessageStatus | "sending" | "failed";

export interface Attachment {
  id: number;
  kind: "image" | "video" | "audio" | "voice" | "file";
  file_name: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  url: string;
}

export interface Reaction {
  user_id: number;
  emoji: string;
}

export interface ReplyPreview {
  id: number;
  sender_id: number | null;
  body: string;
  attachment_kind: Attachment["kind"] | null;
  is_deleted: boolean;
}

export interface SystemMeta {
  event:
    | "group_created"
    | "members_added"
    | "member_removed"
    | "member_left"
    | "role_changed"
    | "name_changed"
    | "description_changed"
    | "avatar_changed"
    | "timer_changed";
  targets?: number[];
  name?: string;
  role?: "admin" | "member";
  seconds?: number | null;
  removed?: boolean;
}

export interface Message {
  id: number;
  conversation_id: number;
  sender_id: number | null;
  client_id: string | null;
  type: "text" | "system";
  body: string;
  meta: SystemMeta | null;
  reply_to: ReplyPreview | null;
  is_forwarded: boolean;
  created_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  expires_in_seconds: number | null;
  expires_at: string | null;
  attachments: Attachment[];
  reactions: Reaction[];
  mentions: number[];
  status: MessageStatus | null;
}

/** A message as held by the client: possibly still sending (negative temporary id). */
export interface ChatMessage extends Omit<Message, "status"> {
  status: LocalStatus | null;
  localAttachments?: LocalAttachment[];
  failureReason?: string;
}

export interface LocalAttachment {
  name: string;
  kind: Attachment["kind"];
  previewUrl: string | null;
  size: number;
}

export interface LastMessage {
  id: number;
  sender_id: number | null;
  type: Message["type"];
  body: string;
  meta: SystemMeta | null;
  attachment_kind: Attachment["kind"] | null;
  created_at: string;
  is_deleted: boolean;
  status: MessageStatus | null;
}

export interface Conversation {
  id: number;
  type: "direct" | "group" | "note_to_self";
  name: string;
  description: string | null;
  avatar_url: string | null;
  avatar_color: AvatarColor;
  peer: User | null;
  member_count: number;
  my_role: "admin" | "member";
  is_member: boolean;
  disappearing_seconds: number | null;
  created_at: string;
  last_activity_at: string;
  last_message: LastMessage | null;
  unread_count: number;
  mention_count: number;
  last_read_message_id: number | null;
  is_pinned: boolean;
  is_archived: boolean;
  muted_until: string | null;
  marked_unread: boolean;
}

export interface Member {
  user: User;
  role: "admin" | "member";
  joined_at: string;
}

export interface ConversationDetail extends Conversation {
  members: Member[];
}

export interface MessagePage {
  items: Message[];
  has_more_before: boolean;
  has_more_after: boolean;
}

export interface MessageInfo {
  message: Message;
  recipients: { user_id: number; delivered_at: string | null; read_at: string | null }[];
}

export interface SearchResults {
  conversations: Conversation[];
  contacts: User[];
  messages: Message[];
}

export interface GroupInCommon {
  id: number;
  name: string;
  avatar_color: AvatarColor;
  avatar_url: string | null;
}

/** Server → client WebSocket events. */
export type ServerEvent =
  | { type: "message.new"; data: Message }
  | { type: "message.updated"; data: Message }
  | { type: "message.hidden"; data: { message_id: number; conversation_id: number } }
  | { type: "message.expired"; data: { conversation_id: number; message_ids: number[] } }
  | {
      type: "message.timer_started";
      data: { id: number; conversation_id: number; expires_at: string }[];
    }
  | {
      type: "reaction.updated";
      data: { message_id: number; conversation_id: number; reactions: Reaction[] };
    }
  | {
      type: "receipt.updated";
      data: { message_id: number; conversation_id: number; status: MessageStatus }[];
    }
  | { type: "typing"; data: { conversation_id: number; user_id: number; is_typing: boolean } }
  | { type: "presence"; data: { user_id: number; online: boolean; last_seen_at: string | null } }
  | { type: "user.updated"; data: Partial<User> & { id: number } }
  | { type: "me.updated"; data: Me }
  | { type: "conversation.updated"; data: Conversation }
  | { type: "conversation.read"; data: { conversation_id: number; last_read_message_id: number } }
  | { type: "conversation.removed"; data: { conversation_id: number } }
  | { type: "error"; data: { detail: string; event: string; ref: Record<string, unknown> } }
  | { type: "pong"; data: null };
