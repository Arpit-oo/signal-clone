"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Avatar, Icon, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import type { Attachment, ChatMessage, Message } from "@/lib/types";
import { displayName, useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { Composer } from "./Composer";
import { MessageBubble } from "./MessageBubble";
import type { MessageAction } from "./MessageBubble";
import {
  DeleteDialog,
  ForwardDialog,
  ImageDialog,
  InfoDialog,
} from "./MessageDialogs";
import { dateLabel, errorMessage, systemMessage, timerLabel } from "./helpers";
import "./chat.css";

interface ChatPaneProps {
  conversationId: number;
  onBack: () => void;
  onDetails: () => void;
}
const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_TYPING: number[] = [];

interface ScrollAnchor {
  elementId: string;
  offset: number;
}

function visibleMessageAnchor(viewport: HTMLDivElement): ScrollAnchor | null {
  const bounds = viewport.getBoundingClientRect();
  for (const message of viewport.querySelectorAll<HTMLElement>(
    "[id^='chat-message-']",
  )) {
    const messageBounds = message.getBoundingClientRect();
    if (
      messageBounds.bottom > bounds.top &&
      messageBounds.top < bounds.bottom
    ) {
      return { elementId: message.id, offset: messageBounds.top - bounds.top };
    }
  }
  return null;
}

function restoreMessageAnchor(
  viewport: HTMLDivElement,
  anchor: ScrollAnchor | null,
): boolean {
  if (!anchor) return false;
  const message = document.getElementById(anchor.elementId);
  if (!message || !viewport.contains(message)) return false;
  viewport.scrollTop +=
    message.getBoundingClientRect().top -
    viewport.getBoundingClientRect().top -
    anchor.offset;
  return true;
}

function ConversationSearch({
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
  const [callType, setCallType] = useState<"voice" | "video" | null>(null);
  const [reply, setReply] = useState<ChatMessage | null>(null);
  const [edit, setEdit] = useState<ChatMessage | null>(null);
  const [dialog, setDialog] = useState<{
    type: "delete" | "forward" | "info";
    message: ChatMessage;
  } | null>(null);
  const [image, setImage] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reactionBusy, setReactionBusy] = useState<number | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const timeline = useRef<HTMLDivElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const timelineContent = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const initialScrolled = useRef(false);
  const previousLastId = useRef<number | null>(null);
  const scrollSnapshot = useRef<{
    height: number;
    top: number;
    firstId: number;
    anchor: ScrollAnchor | null;
  } | null>(null);
  const focusedNonce = useRef<number | null>(null);
  const readingAnchor = useRef<ScrollAnchor | null>(null);
  const viewportSize = useRef<{
    width: number;
    height: number;
    contentHeight: number;
  } | null>(null);

  const rememberScrollPosition = useCallback(() => {
    const viewport = timeline.current;
    if (!viewport) return;
    readingAnchor.current = visibleMessageAnchor(viewport);
    viewportSize.current = {
      width: viewport.clientWidth,
      height: viewport.clientHeight,
      contentHeight: viewport.scrollHeight,
    };
  }, []);

  const preserveScrollPosition = useCallback(() => {
    const viewport = timeline.current;
    if (!viewport || !initialScrolled.current) return;
    if (atBottom.current) viewport.scrollTop = viewport.scrollHeight;
    else if (!scrollSnapshot.current)
      restoreMessageAnchor(viewport, readingAnchor.current);
    rememberScrollPosition();
  }, [rememberScrollPosition]);

  useLayoutEffect(() => {
    const viewport = timeline.current;
    const content = timelineContent.current;
    if (!viewport || !content) return;
    const observer = new ResizeObserver(preserveScrollPosition);
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  }, [preserveScrollPosition]);

  useEffect(() => {
    const state = useChat.getState();
    if (!state.buckets[conversationId]?.loaded)
      void state.loadLatest(conversationId);
    void state.loadDetail(conversationId);
  }, [conversationId]);

  useLayoutEffect(() => {
    const viewport = timeline.current;
    if (!viewport || !bucket?.loaded) return;
    if (
      focusMessage?.conversationId === conversationId &&
      focusMessage.nonce !== focusedNonce.current
    ) {
      const target = document.getElementById(
        `chat-message-${focusMessage.messageId}`,
      );
      if (target) {
        focusedNonce.current = focusMessage.nonce;
        initialScrolled.current = true;
        viewport.scrollTop +=
          target.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top -
          (viewport.clientHeight - target.clientHeight) / 2;
        target.classList.remove("chat-focused");
        requestAnimationFrame(() => target.classList.add("chat-focused"));
        atBottom.current =
          viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
          100;
        rememberScrollPosition();
      }
      return;
    }
    if (
      scrollSnapshot.current &&
      messages[0]?.id !== scrollSnapshot.current.firstId
    ) {
      if (!restoreMessageAnchor(viewport, scrollSnapshot.current.anchor)) {
        viewport.scrollTop =
          scrollSnapshot.current.top +
          viewport.scrollHeight -
          scrollSnapshot.current.height;
      }
      scrollSnapshot.current = null;
    } else {
      const last = messages.at(-1);
      const newMessage = last?.id !== previousLastId.current;
      if (!initialScrolled.current || (newMessage && atBottom.current)) {
        viewport.scrollTop = viewport.scrollHeight;
        initialScrolled.current = true;
      } else restoreMessageAnchor(viewport, readingAnchor.current);
      previousLastId.current = last?.id ?? null;
    }
    rememberScrollPosition();
  }, [
    messages,
    bucket?.loaded,
    focusMessage,
    conversationId,
    rememberScrollPosition,
  ]);

  useEffect(() => {
    function readVisible() {
      if (
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        atBottom.current
      )
        useChat.getState().markRead(conversationId);
    }
    readVisible();
    document.addEventListener("visibilitychange", readVisible);
    window.addEventListener("focus", readVisible);
    return () => {
      document.removeEventListener("visibilitychange", readVisible);
      window.removeEventListener("focus", readVisible);
    };
  }, [
    conversationId,
    messages,
    nearBottom,
    conversation?.unread_count,
    bucket?.hasMoreAfter,
  ]);

  async function older() {
    const viewport = timeline.current;
    const firstId = messages[0]?.id;
    if (viewport && firstId !== undefined)
      scrollSnapshot.current = {
        height: viewport.scrollHeight,
        top: viewport.scrollTop,
        firstId,
        anchor: visibleMessageAnchor(viewport),
      };
    await useChat.getState().loadOlder(conversationId);
    if (useChat.getState().buckets[conversationId]?.items[0]?.id === firstId)
      scrollSnapshot.current = null;
  }
  async function jump(id: number) {
    atBottom.current = false;
    setNearBottom(false);
    await useChat.getState().jumpTo(conversationId, id);
  }
  function closeSearch() {
    setSearchOpen(false);
    searchTrigger.current?.focus();
  }
  function scrollBottom() {
    if (bucket?.hasMoreAfter) {
      initialScrolled.current = false;
      focusedNonce.current = focusMessage?.nonce ?? null;
      void useChat.getState().loadLatest(conversationId);
    } else
      timeline.current?.scrollTo({
        top: timeline.current.scrollHeight,
        behavior: "instant",
      });
    atBottom.current = true;
    setNearBottom(true);
    rememberScrollPosition();
  }
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
  const online = presence?.online ?? conversation.peer?.is_online;
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
    <section
      className="chat-pane"
      aria-label={`Conversation with ${conversation.name}`}
    >
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
                onClick={() => setCallType("video")}
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
                  onClick={() => setCallType("voice")}
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
            ref={searchTrigger}
            className="chat-icon-button"
            onClick={() => {
              if (searchOpen) closeSearch();
              else setSearchOpen(true);
            }}
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
      <div className="chat-body">
        <div className="chat-main">
          {error && (
            <div className="chat-inline-error chat-pane-error" role="alert">
              <Icon name="alert" size={16} />
              <span>{error}</span>
              <button
                className="chat-icon-button"
                aria-label="Dismiss error"
                onClick={() => setError(null)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          <div className="chat-scroll-area">
            <div
              className="chat-timeline scroll-thin"
              ref={timeline}
              onScroll={() => {
                const viewport = timeline.current;
                if (!viewport) return;
                const previousSize = viewportSize.current;
                if (
                  previousSize &&
                  (previousSize.width !== viewport.clientWidth ||
                    previousSize.height !== viewport.clientHeight ||
                    previousSize.contentHeight !== viewport.scrollHeight)
                ) {
                  preserveScrollPosition();
                  return;
                }
                const bottom =
                  viewport.scrollHeight -
                    viewport.scrollTop -
                    viewport.clientHeight <
                  100;
                atBottom.current = bottom;
                setNearBottom(bottom);
                rememberScrollPosition();
              }}
              onLoadCapture={preserveScrollPosition}
            >
              <div className="chat-timeline-inner" ref={timelineContent}>
                {bucket?.hasMoreBefore && bucket.loaded && (
                  <button
                    className="chat-load-history"
                    disabled={bucket.loading}
                    onClick={() => void older()}
                  >
                    {bucket.loading
                      ? "Loading messages…"
                      : "Load earlier messages"}
                  </button>
                )}
                {bucket?.error && (
                  <div className="chat-history-error" role="alert">
                    <p>{bucket.error}</p>
                    <button
                      className="chat-text-button"
                      disabled={bucket.loading}
                      onClick={() => {
                        initialScrolled.current = false;
                        focusedNonce.current = focusMessage?.nonce ?? null;
                        void useChat.getState().loadLatest(conversationId);
                      }}
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
                        name={
                          conversation.type === "note_to_self"
                            ? "edit"
                            : "smile"
                        }
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
                  const previous = messages[index - 1];
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
                          <span>
                            {systemMessage(message, users, me?.id ?? null)}
                          </span>
                        </div>
                      ) : (
                        <MessageBubble
                          message={message}
                          own={message.sender_id === me?.id}
                          grouped={grouped}
                          groupChat={conversation.type === "group"}
                          sender={
                            message.sender_id
                              ? users[message.sender_id]
                              : undefined
                          }
                          users={users}
                          meId={me?.id ?? null}
                          focused={false}
                          onAction={(name, target) => void action(name, target)}
                          onReact={(target, emoji) => void react(target, emoji)}
                          onJump={(id) => void jump(id)}
                          onImage={setImage}
                          onRetry={(clientId) =>
                            useChat.getState().retry(clientId)
                          }
                          onDiscard={(clientId) =>
                            useChat
                              .getState()
                              .discardFailed(conversationId, clientId)
                          }
                          reactionBusy={reactionBusy !== null}
                        />
                      )}
                    </div>
                  );
                })}
                {typing.length > 0 && !bucket?.hasMoreAfter && (
                  <div
                    className="chat-typing-row"
                    role="status"
                    aria-label="Typing"
                  >
                    <div className="chat-typing-bubble">
                      <span className="typing-dot" />
                      <span
                        className="typing-dot"
                        style={{ animationDelay: "160ms" }}
                      />
                      <span
                        className="typing-dot"
                        style={{ animationDelay: "320ms" }}
                      />
                    </div>
                    {conversation.type === "group" && (
                      <small>
                        {typing.map((id) => displayName(users[id])).join(", ")}
                      </small>
                    )}
                  </div>
                )}
                {bucket?.hasMoreAfter && (
                  <button
                    className="chat-load-history"
                    disabled={bucket.loading}
                    onClick={() =>
                      void useChat.getState().loadNewer(conversationId)
                    }
                  >
                    {bucket.loading
                      ? "Loading messages…"
                      : "Load newer messages"}
                  </button>
                )}
              </div>
            </div>
            {(!nearBottom || bucket?.hasMoreAfter) && (
              <button
                className="chat-jump-latest"
                onClick={scrollBottom}
                aria-label="Jump to latest messages"
              >
                <Icon name="chevron-down" size={22} />
                {bucket?.hasMoreAfter && <span>Latest</span>}
                {conversation.unread_count > 0 && (
                  <b>{conversation.unread_count}</b>
                )}
              </button>
            )}
          </div>
          <Composer
            key={edit?.id ?? "compose"}
            conversation={conversation}
            reply={reply}
            edit={edit}
            onCancelContext={() => {
              setReply(null);
              setEdit(null);
            }}
            onSent={() => {
              setReply(null);
              setEdit(null);
              if (!edit) scrollBottom();
            }}
          />
        </div>
        {searchOpen && (
          <ConversationSearch
            conversationId={conversationId}
            onJump={(id) => void jump(id)}
            onClose={closeSearch}
          />
        )}
      </div>
      {image && (
        <ImageDialog attachment={image} onClose={() => setImage(null)} />
      )}
      {callType && (
        <Modal title="Coming Soon" onClose={() => setCallType(null)}>
          <div className="chat-dialog-content chat-call-dialog">
            <h3>{callType === "video" ? "Video calls" : "Voice calls"}</h3>
            <p>
              {callType === "video" ? "Video" : "Voice"} calling is not
              available yet. You can send messages and voice notes in this
              conversation.
            </p>
            <div className="chat-dialog-actions">
              <button
                className="chat-button chat-primary-button"
                onClick={() => setCallType(null)}
              >
                Got it
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog?.type === "delete" && (
        <DeleteDialog
          message={dialog.message}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "forward" && (
        <ForwardDialog
          message={dialog.message}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "info" && (
        <InfoDialog message={dialog.message} onClose={() => setDialog(null)} />
      )}
    </section>
  );
}

export function ChatPane(props: ChatPaneProps) {
  return <ConversationPane key={props.conversationId} {...props} />;
}
export default ChatPane;
