"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/ui";
import type { ChatMessage } from "@/lib/types";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { Composer } from "./Composer";
import { ConversationDialogs } from "./ConversationDialogs";
import { ConversationHeader } from "./ConversationHeader";
import { ConversationSearch } from "./ConversationSearch";
import { MessageTimeline } from "./MessageTimeline";
import { useConversationActions } from "./useConversationActions";
import { useTimelineScroll } from "./useTimelineScroll";
import "./chat.css";
import { wallpaperStyle } from "@/lib/wallpapers";

interface ChatPaneProps {
  conversationId: number;
  onBack: () => void;
  onDetails: () => void;
}
const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_TYPING: number[] = [];

function ConversationPane({
  conversationId,
  onBack,
  onDetails,
}: ChatPaneProps) {
  const conversation = useChat((state) => state.conversations[conversationId]);
  const bucket = useChat((state) => state.buckets[conversationId]);
  const users = useChat((state) => state.users);
  const typing = useChat(
    (state) => state.typing[conversationId] ?? EMPTY_TYPING,
  );
  const presence = useChat((state) =>
    conversation?.peer ? state.presence[conversation.peer.id] : undefined,
  );
  const focusMessage = useChat((state) => state.focusMessage);
  const me = useSession((state) => state.me);
  const messages = bucket?.items ?? EMPTY_MESSAGES;
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const scroll = useTimelineScroll({
    conversationId,
    bucket,
    messages,
    focusMessage,
    unreadCount: conversation?.unread_count,
  });
  const actions = useConversationActions(conversationId, me);

  function closeSearch() {
    setSearchOpen(false);
    searchTrigger.current?.focus();
  }

  if (!conversation)
    return (
      <section className="chat-pane chat-unavailable">
        <Icon name="info" size={38} />
        <h2>This conversation is unavailable</h2>
        <button className="chat-button" onClick={onBack}>
          Back to conversations
        </button>
      </section>
    );

  return (
    <section
      className="chat-pane"
      aria-label={`Conversation with ${conversation.name}`}
    >
      <ConversationHeader
        conversation={conversation}
        online={presence?.online ?? conversation.peer?.is_online}
        users={users}
        typing={typing}
        searchOpen={searchOpen}
        searchButtonRef={searchTrigger}
        onBack={onBack}
        onDetails={onDetails}
        onToggleSearch={() => {
          if (searchOpen) closeSearch();
          else setSearchOpen(true);
        }}
        onCall={actions.openCall}
      />
      <div className="chat-body">
        <div className={`chat-main ${conversation.wallpaper ? "has-wallpaper" : ""}`} style={wallpaperStyle(conversation.wallpaper, conversation.id)}>
          {actions.error && (
            <div className="chat-inline-error chat-pane-error" role="alert">
              <Icon name="alert" size={16} />
              <span>{actions.error}</span>
              <button
                className="chat-icon-button"
                aria-label="Dismiss error"
                onClick={actions.dismissError}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          <MessageTimeline
            conversation={conversation}
            bucket={bucket}
            messages={messages}
            users={users}
            meId={me?.id ?? null}
            typing={typing}
            scroll={scroll}
            messageActions={actions.messageActions}
          />
          <Composer
            key={actions.edit?.id ?? "compose"}
            conversation={conversation}
            reply={actions.reply}
            edit={actions.edit}
            onCancelContext={actions.clearContext}
            onSent={() => {
              actions.clearContext();
              if (!actions.edit) scroll.jumpToLatest();
            }}
          />
        </div>
        {searchOpen && (
          <ConversationSearch
            conversationId={conversationId}
            onJump={(id) => void scroll.jumpToMessage(id)}
            onClose={closeSearch}
          />
        )}
      </div>
      <ConversationDialogs controller={actions.dialogs} />
    </section>
  );
}

export function ChatPane(props: ChatPaneProps) {
  return <ConversationPane key={props.conversationId} {...props} />;
}
export default ChatPane;
