"use client";

import { Icon } from "@/components/ui";
import type { ChatMessage, Conversation, User } from "@/lib/types";
import { MessageBubble } from "./MessageBubble";
import { TypingIndicator } from "./TypingIndicator";
import { dateLabel, systemMessage } from "./helpers";
import type { MessageInteractions } from "./useConversationActions";
import type {
  TimelineBucket,
  TimelineScrollController,
} from "./useTimelineScroll";

interface MessageTimelineProps {
  conversation: Conversation;
  bucket?: TimelineBucket;
  messages: ChatMessage[];
  users: Record<number, User>;
  meId: number | null;
  typing: number[];
  scroll: TimelineScrollController;
  messageActions: MessageInteractions;
}

/** Messages share a group only within the same day, sender and five-minute window. */
export function messageGrouping(
  previous: ChatMessage | undefined,
  message: ChatMessage,
) {
  const newDay =
    !previous ||
    new Date(previous.created_at).toDateString() !==
      new Date(message.created_at).toDateString();
  const grouped =
    !!previous &&
    !newDay &&
    previous.type !== "system" &&
    previous.sender_id === message.sender_id &&
    new Date(message.created_at).getTime() -
      new Date(previous.created_at).getTime() <
      300000;
  return { newDay, grouped };
}

export function MessageTimeline({
  conversation,
  bucket,
  messages,
  users,
  meId,
  typing,
  scroll: {
    viewportRef,
    contentRef,
    nearBottom,
    onScroll,
    preserveScrollPosition,
    loadOlder,
    loadNewer,
    retryLoad,
    jumpToMessage,
    jumpToLatest,
  },
  messageActions,
}: MessageTimelineProps) {
  return (
    <div className="chat-scroll-area">
      <div
        className="chat-timeline scroll-thin"
        ref={viewportRef}
        onScroll={onScroll}
        onLoadCapture={preserveScrollPosition}
      >
        <div className="chat-timeline-inner" ref={contentRef}>
          {bucket?.hasMoreBefore && bucket.loaded && (
            <button
              className="chat-load-history"
              disabled={bucket.loading}
              onClick={() => void loadOlder()}
            >
              {bucket.loading ? "Loading messages…" : "Load earlier messages"}
            </button>
          )}
          {bucket?.error && (
            <div className="chat-history-error" role="alert">
              <p>{bucket.error}</p>
              <button
                className="chat-text-button"
                disabled={bucket.loading}
                onClick={retryLoad}
              >
                Retry loading messages
              </button>
            </div>
          )}
          {(!bucket || !bucket.loaded) && !bucket?.error && (
            <div className="chat-history-state" role="status">
              <span className="chat-spinner" />
              Loading conversation…
            </div>
          )}
          {bucket?.loaded && !messages.length && (
            <div className="chat-empty-history">
              <div className="chat-empty-icon">
                <Icon
                  name={conversation.type === "note_to_self" ? "edit" : "smile"}
                  size={32}
                />
              </div>
              <h2>
                {conversation.type === "note_to_self"
                  ? "Note to Self"
                  : "No messages yet"}
              </h2>
              <p>
                {conversation.type === "note_to_self"
                  ? "Send a message, photo, or file to save it here."
                  : `Send the first message to ${conversation.name}.`}
              </p>
            </div>
          )}
          {messages.map((message, index) => {
            const { newDay, grouped } = messageGrouping(
              messages[index - 1],
              message,
            );
            return (
              <div key={message.client_id ?? message.id}>
                {newDay && (
                  <div className="chat-date-separator">
                    <span>{dateLabel(message.created_at)}</span>
                  </div>
                )}
                {message.type === "system" ? (
                  <div
                    id={`chat-message-${message.id}`}
                    className="chat-system-message"
                  >
                    <Icon
                      name={
                        message.meta?.event === "timer_changed"
                          ? "clock"
                          : "info"
                      }
                      size={13}
                    />
                    <span>{systemMessage(message, users, meId)}</span>
                  </div>
                ) : (
                  <MessageBubble
                    message={message}
                    own={meId !== null && message.sender_id === meId}
                    grouped={grouped}
                    groupChat={conversation.type === "group"}
                    sender={
                      message.sender_id ? users[message.sender_id] : undefined
                    }
                    users={users}
                    meId={meId}
                    focused={false}
                    onAction={(name, target) =>
                      messageActions.onAction(name, target)
                    }
                    onReact={(target, emoji) =>
                      messageActions.onReact(target, emoji)
                    }
                    onJump={(id) => void jumpToMessage(id)}
                    onImage={messageActions.onImage}
                    onRetry={messageActions.onRetry}
                    onDiscard={messageActions.onDiscard}
                    reactionBusy={messageActions.reactionBusy}
                  />
                )}
              </div>
            );
          })}
          {typing.length > 0 && !bucket?.hasMoreAfter && (
            <TypingIndicator
              typing={typing}
              users={users}
              groupChat={conversation.type === "group"}
            />
          )}
          {bucket?.hasMoreAfter && (
            <button
              className="chat-load-history"
              disabled={bucket.loading}
              onClick={loadNewer}
            >
              {bucket.loading ? "Loading messages…" : "Load newer messages"}
            </button>
          )}
        </div>
      </div>
      {(!nearBottom || bucket?.hasMoreAfter) && (
        <button
          className="chat-jump-latest"
          onClick={jumpToLatest}
          aria-label="Jump to latest messages"
        >
          <Icon name="chevron-down" size={22} />
          {bucket?.hasMoreAfter && <span>Latest</span>}
          {conversation.unread_count > 0 && <b>{conversation.unread_count}</b>}
        </button>
      )}
    </div>
  );
}
