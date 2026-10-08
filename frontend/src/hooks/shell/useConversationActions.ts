"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Conversation, Message, User } from "@/lib/types";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { errorMessage } from "@/components/ui";

export interface ConversationSettingsPatch {
  is_pinned?: boolean;
  is_archived?: boolean;
  marked_unread?: boolean;
  mute_seconds?: number;
}

export function useConversationActions({
  selectedId,
  onSelectConversation,
  onBackToChats,
}: {
  selectedId: number | null;
  onSelectConversation: (conversation: Conversation) => void;
  onBackToChats: () => void;
}) {
  const me = useSession((state) => state.me)!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pinningId, setPinningId] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  useEffect(() => {
    if (!statusMessage) return;
    const timer = setTimeout(() => setStatusMessage(""), 6000);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  function clearFeedback() {
    setError("");
    setStatusMessage("");
  }
  async function togglePin(conversation: Conversation) {
    if (pinningId !== null || busy || conversation.is_archived) return;
    setPinningId(conversation.id);
    setError("");
    try {
      const updated = await api.conversations.settings(conversation.id, {
        is_pinned: !conversation.is_pinned,
      });
      useChat.getState().upsertConversation(updated);
      setStatusMessage(
        updated.is_pinned
          ? `${updated.name} is pinned to the top. Saved to your account.`
          : `${updated.name} is unpinned. Saved to your account.`,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPinningId(null);
    }
  }
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(
        me.username ? `@${me.username}` : me.phone,
      );
      setStatusMessage(
        "Your address was copied. Share it with someone you know.",
      );
    } catch {
      setError(
        "Couldn’t copy your address. Select your username or phone number to copy it.",
      );
    }
  }
  async function openPerson(user: User) {
    setBusy(true);
    setError("");
    try {
      const conversation = await api.conversations.createDirect(user.id);
      useChat.getState().upsertConversation(conversation);
      onSelectConversation(conversation);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function openMessage(message: Message) {
    setBusy(true);
    setError("");
    try {
      let conversation =
        useChat.getState().conversations[message.conversation_id];
      if (!conversation) {
        conversation = await api.conversations.get(message.conversation_id);
        useChat.getState().upsertConversation(conversation);
      }
      onSelectConversation(conversation);
      await useChat.getState().jumpTo(message.conversation_id, message.id);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function updateConversation(
    conversation: Conversation,
    patch: ConversationSettingsPatch,
  ) {
    setBusy(true);
    setError("");
    try {
      useChat
        .getState()
        .upsertConversation(
          await api.conversations.settings(conversation.id, patch),
        );
      if (patch.marked_unread && selectedId === conversation.id)
        onBackToChats();
      if (patch.is_pinned !== undefined)
        setStatusMessage(
          patch.is_pinned
            ? `${conversation.name} is pinned to the top. Saved to your account.`
            : `${conversation.name} is unpinned. Saved to your account.`,
        );
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function toggleRead(conversation: Conversation) {
    if (!conversation.unread_count && !conversation.marked_unread)
      return updateConversation(conversation, { marked_unread: true });
    setBusy(true);
    setError("");
    try {
      const lastId = conversation.last_message?.id;
      const latest =
        lastId && lastId > 0
          ? lastId
          : (await api.conversations.messages(conversation.id, { limit: 1 }))
              .items[0]?.id;
      if (latest) await api.conversations.markRead(conversation.id, latest);
      else
        useChat
          .getState()
          .upsertConversation(
            await api.conversations.settings(conversation.id, {
              marked_unread: false,
            }),
          );
      const updated = await api.conversations.get(conversation.id);
      useChat.getState().upsertConversation(updated);
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return {
    busy,
    error,
    pinningId,
    statusMessage,
    clearFeedback,
    clearError: () => setError(""),
    togglePin,
    copyAddress,
    openPerson,
    openMessage,
    updateConversation,
    toggleRead,
  };
}
