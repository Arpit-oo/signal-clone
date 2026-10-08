import type { ChatMessage, User } from "@/lib/types";
import { displayName } from "@/stores/chat";

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function dateLabel(value: string): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  today.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

export function timerLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) return `${seconds / 60} minutes`;
  if (seconds < 86400) return `${seconds / 3600} hours`;
  return `${seconds / 86400} days`;
}

export function systemMessage(
  message: ChatMessage,
  users: Record<number, User>,
  meId: number | null,
): string {
  const actor =
    message.sender_id === meId
      ? "You"
      : displayName(message.sender_id ? users[message.sender_id] : null);
  const meta = message.meta;
  if (!meta) return message.body;
  const targets = (meta.targets ?? [])
    .map((id) => (id === meId ? "you" : displayName(users[id])))
    .join(", ");
  switch (meta.event) {
    case "group_created":
      return `${actor} created the group`;
    case "members_added":
      return `${actor} added ${targets || "new members"}`;
    case "member_removed":
      return `${actor} removed ${targets || "a member"}`;
    case "member_left":
      return `${actor} left the group`;
    case "role_changed":
      return `${targets || "A member"} is now ${meta.role === "admin" ? "an admin" : "a member"}`;
    case "name_changed":
      return `${actor} changed the group name to “${meta.name ?? ""}”`;
    case "description_changed":
      return `${actor} ${meta.removed ? "removed" : "changed"} the group description`;
    case "avatar_changed":
      return `${actor} ${meta.removed ? "removed" : "changed"} the group photo`;
    case "timer_changed":
      return meta.seconds
        ? `${actor} set disappearing messages to ${timerLabel(meta.seconds)}`
        : `${actor} turned off disappearing messages`;
    default:
      return message.body;
  }
}
