"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { api, ApiError } from "@/lib/api";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { errorMessage } from "@/components/ui";
import type { ConversationFilter } from "./useConversationList";

export interface ConversationRouteResult {
  id: number;
  error: string;
  inaccessible: boolean;
}

export function useConversationRoute(
  initialConversationId: number | undefined,
  setFilter: Dispatch<SetStateAction<ConversationFilter>>,
) {
  const meId = useSession((state) => state.me!.id);
  const conversations = useChat((state) => state.conversations);
  const loaded = useChat((state) => state.conversationsLoaded);
  const conversationsError = useChat((state) => state.conversationsError);
  const selectedId =
    initialConversationId &&
    Number.isSafeInteger(initialConversationId) &&
    initialConversationId > 0
      ? initialConversationId
      : null;
  const [routeResult, setRouteResult] =
    useState<ConversationRouteResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!selectedId || !loaded || conversationsError) return;
    let active = true;
    api.conversations
      .get(selectedId)
      .then((conversation) => {
        if (!active) return;
        useChat.getState().upsertConversation(conversation);
        useChat.setState((state) => ({
          details: { ...state.details, [conversation.id]: conversation },
        }));
        useChat
          .getState()
          .rememberUsers(conversation.members.map((member) => member.user));
        setFilter(conversation.is_archived ? "archive" : "all");
        setRouteResult({ id: selectedId, error: "", inaccessible: false });
      })
      .catch((cause) => {
        if (!active) return;
        const inaccessible =
          cause instanceof ApiError &&
          (cause.status === 403 || cause.status === 404);
        setRouteResult({
          id: selectedId,
          error: inaccessible
            ? "You may not have access to this conversation, or it may have been deleted."
            : errorMessage(cause),
          inaccessible,
        });
      });
    return () => {
      active = false;
    };
  }, [selectedId, loaded, conversationsError, attempt, meId, setFilter]);

  const routeError = routeResult?.id === selectedId ? routeResult.error : "";
  const selected = selectedId && !routeError ? conversations[selectedId] : null;
  function retry() {
    setRouteResult(null);
    if (conversationsError) void useChat.getState().loadConversations();
    else setAttempt((value) => value + 1);
  }
  return {
    selectedId,
    selected,
    routeResult,
    routeError,
    conversationsError,
    retry,
  };
}
