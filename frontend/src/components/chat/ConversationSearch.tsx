"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui";
import { api } from "@/lib/api";
import type { Message } from "@/lib/types";
import { displayName, useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { errorMessage } from "./helpers";

export function ConversationSearch({
  conversationId,
  onJump,
  onClose,
}: {
  conversationId: number;
  onJump: (id: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{
    query: string;
    items: Message[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const users = useChat((state) => state.users);
  const me = useSession((state) => state.me);
  useEffect(() => {
    if (!query.trim()) return;
    let active = true;
    const timer = setTimeout(() => {
      api.conversations
        .searchMessages(conversationId, query.trim())
        .then((items) => {
          if (active) setResult({ query, items });
        })
        .catch((cause) => {
          if (active) setError(errorMessage(cause));
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, conversationId, attempt]);
  return (
    <aside className="chat-search-panel" aria-label="Search in conversation">
      <div className="chat-search-heading">
        <strong>Search conversation</strong>
        <button
          className="chat-icon-button"
          aria-label="Close conversation search"
          onClick={onClose}
        >
          <Icon name="close" size={19} />
        </button>
      </div>
      <label className="chat-search-input">
        <Icon name="search" size={18} />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setError(null);
          }}
          autoFocus
          placeholder="Search messages"
          aria-label="Search messages in this conversation"
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
          }}
        />
      </label>
      <div className="chat-search-results scroll-thin">
        {!query.trim() && (
          <p className="chat-muted">
            Find a word, a memory, or an important detail.
          </p>
        )}
        {error && (
          <div className="chat-inline-error" role="alert">
            <span>{error}</span>
            <button
              className="chat-text-button"
              onClick={() => {
                setError(null);
                setAttempt((value) => value + 1);
              }}
            >
              Retry
            </button>
          </div>
        )}
        {query.trim() && !error && result?.query !== query && (
          <p className="chat-loading" role="status">
            Searching…
          </p>
        )}
        {query.trim() && !error && result?.query === query && (
          <>
            <p className="chat-search-count">
              {result.items.length} result{result.items.length === 1 ? "" : "s"}
            </p>
            {result.items.length === 0 && (
              <p className="chat-muted">No messages found.</p>
            )}
            {result.items.map((message) => (
              <button
                key={message.id}
                className="chat-search-result"
                onClick={() => {
                  onJump(message.id);
                  if (window.matchMedia("(max-width: 760px)").matches)
                    onClose();
                }}
              >
                <div>
                  <strong>
                    {message.sender_id === me?.id
                      ? "You"
                      : displayName(
                          message.sender_id ? users[message.sender_id] : null,
                        )}
                  </strong>
                  <time>
                    {new Date(message.created_at).toLocaleDateString(
                      undefined,
                      { month: "short", day: "numeric" },
                    )}
                  </time>
                </div>
                <p>{message.body || "Attachment"}</p>
              </button>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
