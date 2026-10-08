"use client";

import type { RefObject } from "react";
import { Avatar, Icon } from "@/components/ui";
import type { Conversation, User } from "@/lib/types";
import { displayName } from "@/stores/chat";
import { timerLabel } from "./helpers";
import type { CallType } from "./useConversationActions";

interface ConversationHeaderProps {
  conversation: Conversation;
  online?: boolean;
  users: Record<number, User>;
  typing: number[];
  searchOpen: boolean;
  searchButtonRef: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  onDetails: () => void;
  onToggleSearch: () => void;
  onCall: (type: CallType) => void;
}

export function ConversationHeader({
  conversation,
  online,
  users,
  typing,
  searchOpen,
  searchButtonRef,
  onBack,
  onDetails,
  onToggleSearch,
  onCall,
}: ConversationHeaderProps) {
  const subtitle =
    conversation.type === "note_to_self"
      ? "Messages you send to yourself"
      : conversation.type === "group"
        ? `${conversation.member_count} members`
        : online
          ? "Online"
          : conversation.peer?.about ||
            conversation.peer?.phone ||
            "Signal conversation";

  return (
    <header className="chat-header">
      <button
        className="chat-icon-button chat-back"
        onClick={onBack}
        aria-label="Back to conversations"
      >
        <Icon name="arrow-left" size={22} />
      </button>
      <button className="chat-header-contact" onClick={onDetails}>
        <Avatar
          name={conversation.name}
          color={conversation.avatar_color}
          url={conversation.avatar_url}
          size={32}
        />
        <span>
          <strong>{conversation.name}</strong>
          <small>
            <span className="chat-header-subtitle">
              {typing.length > 0
                ? `${typing.length === 1 && conversation.type === "group" ? `${displayName(users[typing[0]])} is ` : ""}typing…`
                : subtitle}
            </span>
            {!!conversation.disappearing_seconds && typing.length === 0 && (
              <span className="chat-mobile-timer">
                <Icon name="clock" size={12} />
                {timerLabel(conversation.disappearing_seconds)}
              </span>
            )}
          </small>
        </span>
      </button>
      <div className="chat-header-actions">
        {conversation.type !== "note_to_self" && (
          <>
            <button
              className="chat-icon-button chat-call-button"
              aria-label="Video call"
              aria-haspopup="dialog"
              title="Video call · Coming Soon"
              onClick={() => onCall("video")}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="5" width="13" height="14" rx="3" />
                <path d="m16 9 5-3v12l-5-3" />
              </svg>
            </button>
            {conversation.type === "direct" && (
              <button
                className="chat-icon-button chat-call-button"
                aria-label="Voice call"
                aria-haspopup="dialog"
                title="Voice call · Coming Soon"
                onClick={() => onCall("voice")}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m5 3 4 5-2 3a14 14 0 0 0 6 6l3-2 5 4-2 3C9 22 2 15 2 5l3-2Z" />
                </svg>
              </button>
            )}
          </>
        )}
        {conversation.disappearing_seconds && (
          <button
            className="chat-icon-button chat-timer"
            onClick={onDetails}
            aria-label={`Disappearing messages set to ${timerLabel(conversation.disappearing_seconds)}`}
            title={`Disappearing messages: ${timerLabel(conversation.disappearing_seconds)}`}
          >
            <Icon name="clock" size={19} />
          </button>
        )}
        <button
          ref={searchButtonRef}
          className="chat-icon-button"
          onClick={onToggleSearch}
          aria-label="Search conversation"
          aria-expanded={searchOpen}
        >
          <Icon name="search" size={21} />
        </button>
        <button
          className="chat-icon-button"
          onClick={onDetails}
          aria-label="Conversation details"
        >
          <Icon name="more" size={21} />
        </button>
      </div>
    </header>
  );
}
