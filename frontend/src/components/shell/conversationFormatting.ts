import type { Conversation } from "@/lib/types";

export function timeLabel(value: string, timestamp: number) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const now = new Date(timestamp);
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (timestamp - date.getTime() < 7 * 86400000)
    return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
export function conversationPreview(c: Conversation, meId: number) {
  const msg = c.last_message;
  if (!msg) return "Start a conversation";
  if (msg.is_deleted) return "Message deleted";
  if (msg.type === "system") return msg.body || "Group updated";
  const attachment = msg.attachment_kind
    ? {
        image: "Photo",
        video: "Video",
        voice: "Voice message",
        audio: "Audio",
        file: "File",
      }[msg.attachment_kind]
    : "";
  return `${msg.sender_id === meId && c.type !== "note_to_self" ? "You: " : ""}${msg.body || attachment}`;
}
