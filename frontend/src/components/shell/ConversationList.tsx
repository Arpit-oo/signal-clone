"use client";

import type { ReactNode } from "react";
import type { Conversation } from "@/lib/types";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { Button, ErrorText, Icon, IconButton, Spinner } from "@/components/ui";
import {
  useConversationList,
  type ConversationFilter,
} from "@/hooks/shell/useConversationList";
import ConversationRow from "./ConversationRow";

export default function ConversationList({
  filter,
  selectedId,
  query,
  onSelect,
  onMenu,
  onPin,
  pinningId,
  busy,
  actionError,
  onNewChat,
  onCopyAddress,
  children,
}: {
  filter: ConversationFilter;
  selectedId: number | null;
  query: string;
  onSelect: (id: number) => void;
  onMenu: (conversation: Conversation, anchor: HTMLElement) => void;
  onPin: (conversation: Conversation) => void;
  pinningId: number | null;
  busy: boolean;
  actionError: string;
  onNewChat: () => void;
  onCopyAddress: () => void;
  children: ReactNode;
}) {
  const me = useSession((state) => state.me)!;
  const {
    visible,
    loaded,
    error: conversationsError,
    freshAccount,
  } = useConversationList(filter);
  return (
    <div className="conversation-list scroll-thin">
      {conversationsError && loaded && (
        <div className="conversation-refresh-error">
          <ErrorText>{conversationsError}</ErrorText>
          <Button
            variant="secondary"
            onClick={() => void useChat.getState().loadConversations()}
          >
            Retry conversations
          </Button>
        </div>
      )}
      {query.trim() ? (
        children
      ) : conversationsError && !loaded ? (
        <div className="sidebar-state">
          <ErrorText>{conversationsError}</ErrorText>
          <Button
            variant="secondary"
            onClick={() => void useChat.getState().loadConversations()}
          >
            Retry
          </Button>
        </div>
      ) : !loaded ? (
        <div className="sidebar-state">
          <Spinner />
          <p>Loading your conversations…</p>
        </div>
      ) : visible.length ? (
        visible.map((c, index) => (
          <div key={c.id}>
            {c.is_pinned && !visible[index - 1]?.is_pinned && (
              <p className="section-label conversation-section">Pinned</p>
            )}
            {!c.is_pinned && (visible[index - 1]?.is_pinned || index === 0) && (
              <p className="section-label conversation-section">
                {filter === "archive" ? "Archived chats" : "Chats"}
              </p>
            )}
            <ConversationRow
              conversation={c}
              selected={c.id === selectedId}
              onSelect={() => onSelect(c.id)}
              onMenu={onMenu}
              onPin={(conversation) => onPin(conversation)}
              pinning={pinningId === c.id}
              pinDisabled={pinningId !== null || busy}
            />
          </div>
        ))
      ) : (
        <div className="sidebar-state">
          <Icon name={filter === "archive" ? "archive" : "chat"} size={34} />
          <p>
            {filter === "unread"
              ? "You’re all caught up"
              : filter === "archive"
                ? "No archived conversations"
                : filter === "pinned"
                  ? "No pinned conversations"
                  : "No conversations yet"}
          </p>
          <small>
            {filter === "unread"
              ? "New messages will appear here."
              : filter === "pinned"
                ? "Use the pin on a chat to keep it at the top."
                : "Find someone by their phone number or username."}
          </small>
          {filter === "all" && (
            <Button variant="secondary" onClick={() => onNewChat()}>
              New conversation
            </Button>
          )}
        </div>
      )}
      <ErrorText>{actionError}</ErrorText>
      {freshAccount && !query.trim() && filter === "all" && (
        <div className="first-chat-card">
          <strong>Find someone you know</strong>
          <p>Enter their phone number or username to start a chat.</p>
          <Button variant="secondary" onClick={() => onNewChat()}>
            <Icon name="compose" size={17} />
            Find a person
          </Button>
          <div className="your-chat-address">
            <span>
              Your address{" "}
              <strong>{me.username ? `@${me.username}` : me.phone}</strong>
            </span>
            <IconButton
              name="copy"
              label="Copy your address"
              onClick={() => onCopyAddress()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
