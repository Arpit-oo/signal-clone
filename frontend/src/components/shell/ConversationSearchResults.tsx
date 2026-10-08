"use client";

import type { Conversation, Message, SearchResults, User } from "@/lib/types";
import { useChat } from "@/stores/chat";
import {
  Avatar,
  Button,
  ErrorText,
  Icon,
  Spinner,
  useNow,
} from "@/components/ui";
import { timeLabel } from "./conversationFormatting";

export default function ConversationSearchResults({
  results,
  onConversation,
  onPerson,
  onMessage,
  query,
  pending,
  error,
  onRetry,
  busy,
}: {
  results: SearchResults | null;
  onConversation: (c: Conversation) => void;
  onPerson: (user: User) => void;
  onMessage: (msg: Message) => void;
  query: string;
  pending: boolean;
  error: string;
  onRetry: () => void;
  busy: boolean;
}) {
  const now = useNow();
  const conversations = useChat((state) => state.conversations);
  if (error)
    return (
      <div className="sidebar-state">
        <ErrorText>{error}</ErrorText>
        <Button variant="secondary" onClick={onRetry}>
          Retry search
        </Button>
      </div>
    );
  if (pending || !results)
    return (
      <div className="sidebar-state">
        <Spinner />
        <p>Searching conversations…</p>
      </div>
    );
  const empty =
    !results.conversations.length &&
    !results.contacts.length &&
    !results.messages.length;
  return (
    <div className="sidebar-search-results">
      {empty && (
        <div className="sidebar-state">
          <Icon name="search" size={32} />
          <p>No results for “{query}”</p>
          <small>Try another name or word.</small>
        </div>
      )}
      {results.conversations.length > 0 && (
        <>
          <p className="section-label">CONVERSATIONS</p>
          {results.conversations.map((c) => (
            <button
              type="button"
              className="person-row"
              key={c.id}
              onClick={() => onConversation(c)}
            >
              <Avatar
                name={c.name}
                color={c.avatar_color}
                url={c.avatar_url}
                size={39}
              />
              <span className="person-info">
                <strong>{c.peer?.nickname || c.name}</strong>
                <small>
                  {c.type === "group"
                    ? `${c.member_count} members`
                    : c.peer?.phone || "Note to Self"}
                </small>
              </span>
            </button>
          ))}
        </>
      )}
      {results.contacts.length > 0 && (
        <>
          <p className="section-label">PEOPLE</p>
          {results.contacts.map((user) => (
            <button
              type="button"
              className="person-row"
              key={user.id}
              disabled={busy}
              onClick={() => onPerson(user)}
            >
              <Avatar
                name={user.nickname || user.display_name}
                color={user.avatar_color}
                url={user.avatar_url}
                size={39}
              />
              <span className="person-info">
                <strong>{user.nickname || user.display_name}</strong>
                <small>
                  {user.username ? `@${user.username}` : user.phone}
                </small>
              </span>
            </button>
          ))}
        </>
      )}
      {results.messages.length > 0 && (
        <>
          <p className="section-label">MESSAGES</p>
          {results.messages.map((msg) => (
            <button
              type="button"
              className="search-message-row"
              key={msg.id}
              onClick={() => onMessage(msg)}
            >
              <Icon name="chat" size={19} />
              <span>
                <strong>{msg.body || "Attachment"}</strong>
                <small>
                  {conversations[msg.conversation_id]?.name ||
                    results.conversations.find(
                      (c) => c.id === msg.conversation_id,
                    )?.name ||
                    "Conversation"}{" "}
                  · {timeLabel(msg.created_at, now)}
                </small>
              </span>
              <Icon name="chevron-right" size={15} />
            </button>
          ))}
        </>
      )}
    </div>
  );
}
