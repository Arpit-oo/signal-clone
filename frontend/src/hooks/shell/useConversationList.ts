"use client";

import { sortConversations, useChat } from "@/stores/chat";

export type ConversationFilter = "all" | "unread" | "pinned" | "archive";

export function useConversationList(filter: ConversationFilter) {
  const conversations = useChat((state) => state.conversations);
  const loaded = useChat((state) => state.conversationsLoaded);
  const error = useChat((state) => state.conversationsError);
  const all = sortConversations(Object.values(conversations));
  const visible = all.filter((conversation) =>
    filter === "archive"
      ? conversation.is_archived
      : !conversation.is_archived &&
        (filter !== "unread" ||
          conversation.unread_count > 0 ||
          conversation.marked_unread) &&
        (filter !== "pinned" || conversation.is_pinned),
  );
  const archiveCount = all.filter(
    (conversation) => conversation.is_archived,
  ).length;
  const unreadCount = all.filter(
    (conversation) =>
      !conversation.is_archived &&
      (conversation.unread_count || conversation.marked_unread),
  ).length;
  const pinnedCount = all.filter(
    (conversation) => conversation.is_pinned && !conversation.is_archived,
  ).length;
  const freshAccount =
    loaded && !all.some((conversation) => conversation.type !== "note_to_self");
  return {
    visible,
    loaded,
    error,
    archiveCount,
    unreadCount,
    pinnedCount,
    freshAccount,
  };
}
