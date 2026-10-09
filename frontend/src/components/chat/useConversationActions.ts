"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { Attachment, ChatMessage, Me } from "@/lib/types";
import { useChat } from "@/stores/chat";
import type { MessageAction } from "./MessageBubble";
import { errorMessage } from "./helpers";
import { useCall } from "@/stores/call";

export type CallType = "voice" | "video";
type MessageDialog = {
  type: "delete" | "forward" | "info";
  message: ChatMessage;
};

export interface MessageInteractions {
  onAction: (action: MessageAction, message: ChatMessage) => void;
  onReact: (message: ChatMessage, emoji: string) => void;
  onImage: (attachment: Attachment) => void;
  onRetry: (clientId: string) => void;
  onDiscard: (clientId: string) => void;
  reactionBusy: boolean;
}

export interface ConversationDialogController {
  image: Attachment | null;
  messageDialog: MessageDialog | null;
  closeImage: () => void;
  closeMessage: () => void;
}

interface ConversationActions {
  reply: ChatMessage | null;
  edit: ChatMessage | null;
  error: string | null;
  clearContext: () => void;
  dismissError: () => void;
  openCall: (type: CallType) => void;
  messageActions: MessageInteractions;
  dialogs: ConversationDialogController;
}

/** Coordinates message mutations, composer context, failures and modal selections. */
export function useConversationActions(
  conversationId: number,
  me: Me | null,
): ConversationActions {
  const [reply, setReply] = useState<ChatMessage | null>(null);
  const [edit, setEdit] = useState<ChatMessage | null>(null);
  const [dialog, setDialog] = useState<{
    type: "delete" | "forward" | "info";
    message: ChatMessage;
  } | null>(null);
  const [image, setImage] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reactionBusy, setReactionBusy] = useState<number | null>(null);

  async function action(name: MessageAction, message: ChatMessage) {
    setError(null);
    if (name === "reply") {
      setEdit(null);
      setReply(message);
    } else if (name === "edit") {
      setReply(null);
      setEdit(message);
    } else if (name === "copy") {
      try {
        await navigator.clipboard.writeText(message.body);
      } catch {
        setError(
          "Couldn’t copy this message. Select its text to copy it manually.",
        );
      }
    } else setDialog({ type: name, message });
  }
  async function react(message: ChatMessage, emoji: string) {
    if (!me || reactionBusy !== null) return;
    setReactionBusy(message.id);
    setError(null);
    try {
      const mine = message.reactions.find(
        (reaction) => reaction.user_id === me.id,
      );
      const removing = mine?.emoji === emoji;
      if (removing) await api.messages.unreact(message.id);
      else await api.messages.react(message.id, emoji);
      const current = useChat
        .getState()
        .buckets[conversationId]?.items.find((item) => item.id === message.id);
      const reactions = (current?.reactions ?? message.reactions).filter(
        (reaction) => reaction.user_id !== me.id,
      );
      if (!removing) reactions.push({ user_id: me.id, emoji });
      useChat.getState().handleEvent({
        type: "reaction.updated",
        data: {
          message_id: message.id,
          conversation_id: conversationId,
          reactions,
        },
      });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setReactionBusy(null);
    }
  }

  return {
    reply,
    edit,
    error,
    clearContext: () => {
      setReply(null);
      setEdit(null);
    },
    dismissError: () => setError(null),
    openCall: (kind) => {
      const conversation = useChat.getState().conversations[conversationId];
      if (conversation) void useCall.getState().start(conversation, kind);
    },
    messageActions: {
      onAction: (name, message) => {
        void action(name, message);
      },
      onReact: (message, emoji) => {
        void react(message, emoji);
      },
      onImage: setImage,
      onRetry: (clientId) => useChat.getState().retry(clientId),
      onDiscard: (clientId) =>
        useChat.getState().discardFailed(conversationId, clientId),
      reactionBusy: reactionBusy !== null,
    },
    dialogs: {
      image,
      messageDialog: dialog,
      closeImage: () => setImage(null),
      closeMessage: () => setDialog(null),
    },
  };
}
