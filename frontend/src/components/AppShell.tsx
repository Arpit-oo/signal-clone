"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "@/lib/api";
import type { Conversation, Message, SearchResults, User } from "@/lib/types";
import { socket, type SocketStatus } from "@/lib/ws";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { usePrefs } from "@/stores/prefs";
import { ChatPane } from "@/components/chat/ChatPane";
import ConversationDetails from "./ConversationDetails";
import NewChat from "./NewChat";
import Settings from "./Settings";
import {
  Avatar,
  Button,
  ErrorText,
  Icon,
  IconButton,
  Spinner,
  errorMessage,
  useNow,
} from "./ui";

function timeLabel(value: string, timestamp: number) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const now = new Date(timestamp);
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (timestamp - date.getTime() < 7 * 86400000)
    return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
function preview(c: Conversation, meId: number) {
  const msg = c.last_message;
  if (!msg) return "Start a conversation";
  if (msg.is_deleted) return "Message deleted";
  if (msg.type === "system") return msg.body || "Group updated";
  const attachment = msg.attachment_kind
    ? {
        image: "Photo",
        video: "Video",
        voice: "Voice message",
        audio: "Audio",
        file: "File",
      }[msg.attachment_kind]
    : "";
  return `${msg.sender_id === meId && c.type !== "note_to_self" ? "You: " : ""}${msg.body || attachment}`;
}
function ConversationRow({
  conversation: c,
  selected,
  onSelect,
  onMenu,
}: {
  conversation: Conversation;
  selected: boolean;
  onSelect: () => void;
  onMenu: (c: Conversation, anchor: HTMLElement) => void;
}) {
  const now = useNow();
  const meId = useSession((s) => s.me!.id);
  const typing = useChat((s) => s.typing[c.id]);
  const presence = useChat((s) => (c.peer ? s.presence[c.peer.id] : undefined));
  const unread = c.unread_count > 0 || c.marked_unread;
  const name =
    c.type === "note_to_self" ? "Note to Self" : c.peer?.nickname || c.name;
  const muted = !!c.muted_until && new Date(c.muted_until).getTime() > now;
  return (
    <div
      className={`conversation-row ${selected ? "selected" : ""} ${unread ? "unread" : ""}`}
    >
      <button
        className="conversation-select"
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
      >
        <span className="conversation-avatar">
          <Avatar
            name={name}
            color={c.peer?.avatar_color || c.avatar_color}
            url={c.peer?.avatar_url || c.avatar_url}
            size={48}
          />
          {c.type === "note_to_self" && (
            <span className="note-avatar">
              <Icon name="file" size={23} />
            </span>
          )}
          {presence?.online && <span className="online-dot" />}
        </span>
        <span className="conversation-copy">
          <span className="conversation-topline">
            <strong>{name}</strong>
            <time dateTime={c.last_activity_at}>
              {timeLabel(c.last_activity_at, now)}
            </time>
          </span>
          <span className="conversation-preview">
            <span className={typing?.length ? "typing-preview" : ""}>
              {typing?.length ? "Typing…" : preview(c, meId)}
            </span>
            <span className="conversation-badges">
              {muted && <Icon name="bell-off" size={14} />}{" "}
              {c.is_pinned && <Icon name="pin" size={13} />}{" "}
              {unread && (
                <span className={`unread-badge ${muted ? "muted" : ""}`}>
                  {c.mention_count ? "@" : c.unread_count || ""}
                </span>
              )}
            </span>
          </span>
        </span>
      </button>
      <button
        className="conversation-menu-trigger"
        type="button"
        aria-label={`Options for ${name}`}
        onClick={(event) => onMenu(c, event.currentTarget)}
        aria-haspopup="menu"
      >
        <Icon name="more" size={18} />
      </button>
    </div>
  );
}

function SearchPanel({
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

export default function AppShell() {
  const now = useNow();
  const me = useSession((s) => s.me)!;
  const conversations = useChat((s) => s.conversations);
  const loaded = useChat((s) => s.conversationsLoaded);
  const conversationsError = useChat((s) => s.conversationsError);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [details, setDetails] = useState(false);
  const [settings, setSettings] = useState(false);
  const [newChat, setNewChat] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread" | "archive">("all");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{
    query: string;
    results: SearchResults | null;
    error: string;
  }>({ query: "", results: null, error: "" });
  const [menuState, setMenu] = useState<Conversation | null>(null);
  const menu = menuState ? (conversations[menuState.id] ?? menuState) : null;
  const menuId = menu?.id;
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLElement | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [socketStatus, setSocketStatus] = useState<SocketStatus>(socket.status);
  const paneWidth = usePrefs((s) => s.leftPaneWidth);
  useEffect(() => socket.onStatus(setSocketStatus), []);
  useEffect(() => {
    if (!query.trim()) return;
    let active = true;
    const timer = setTimeout(
      () =>
        api
          .search(query.trim())
          .then((results) => {
            if (active) {
              useChat.getState().rememberUsers(results.contacts);
              setSearch({ query, results, error: "" });
            }
          })
          .catch((e) => {
            if (active)
              setSearch({ query, results: null, error: errorMessage(e) });
          }),
      250,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, searchAttempt]);
  useEffect(() => {
    if (!menuId) return;
    const frame = requestAnimationFrame(() =>
      menuRef.current
        ?.querySelector<HTMLElement>("button:not(:disabled)")
        ?.focus(),
    );
    function close(event: KeyboardEvent) {
      if (event.key === "Escape") setMenu(null);
    }
    document.addEventListener("keydown", close);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", close);
      if (menuTrigger.current?.isConnected) menuTrigger.current.focus();
    };
  }, [menuId]);
  function openMenu(conversation: Conversation, anchor: HTMLElement) {
    const bounds = anchor.getBoundingClientRect();
    menuTrigger.current = anchor;
    setMenuPosition({
      left: Math.max(8, Math.min(bounds.right - 238, window.innerWidth - 254)),
      top:
        bounds.bottom + 288 < window.innerHeight
          ? bounds.bottom + 6
          : Math.max(8, bounds.top - 288),
    });
    setActionError("");
    setMenu(conversation);
  }
  const all = Object.values(conversations).sort(
    (a, b) =>
      Number(b.is_pinned) - Number(a.is_pinned) ||
      new Date(b.last_activity_at).getTime() -
        new Date(a.last_activity_at).getTime(),
  );
  const visible = all.filter((c) =>
    filter === "archive"
      ? c.is_archived
      : !c.is_archived &&
        (filter !== "unread" || c.unread_count > 0 || c.marked_unread),
  );
  const archiveCount = all.filter((c) => c.is_archived).length;
  const unreadCount = all.filter(
    (c) => !c.is_archived && (c.unread_count || c.marked_unread),
  ).length;
  const selected = selectedId ? conversations[selectedId] : null;
  const select = (id: number) => {
    setSelectedId(id);
    setDetails(false);
    setQuery("");
    setMenu(null);
    setActionError("");
  };
  async function person(user: User) {
    setBusy(true);
    setActionError("");
    try {
      const c = await api.conversations.createDirect(user.id);
      useChat.getState().upsertConversation(c);
      setFilter(c.is_archived ? "archive" : "all");
      select(c.id);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function openMessage(message: Message) {
    setBusy(true);
    setActionError("");
    try {
      let conversation =
        useChat.getState().conversations[message.conversation_id];
      if (!conversation) {
        conversation = await api.conversations.get(message.conversation_id);
        useChat.getState().upsertConversation(conversation);
      }
      setFilter(conversation.is_archived ? "archive" : "all");
      select(message.conversation_id);
      await useChat.getState().jumpTo(message.conversation_id, message.id);
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function menuAction(patch: {
    is_pinned?: boolean;
    is_archived?: boolean;
    marked_unread?: boolean;
    mute_seconds?: number;
  }) {
    if (!menu) return;
    setBusy(true);
    setActionError("");
    try {
      useChat
        .getState()
        .upsertConversation(await api.conversations.settings(menu.id, patch));
      if (patch.marked_unread && selectedId === menu.id) {
        setSelectedId(null);
        setDetails(false);
      }
      setMenu(null);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function toggleRead() {
    if (!menu) return;
    if (!menu.unread_count && !menu.marked_unread) {
      await menuAction({ marked_unread: true });
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      const lastId = menu.last_message?.id;
      const latest =
        lastId && lastId > 0
          ? lastId
          : (await api.conversations.messages(menu.id, { limit: 1 })).items[0]
              ?.id;
      if (latest) await api.conversations.markRead(menu.id, latest);
      else
        useChat
          .getState()
          .upsertConversation(
            await api.conversations.settings(menu.id, { marked_unread: false }),
          );
      const updated = await api.conversations.get(menu.id);
      useChat.getState().upsertConversation(updated);
      setMenu(null);
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      className={`app-shell ${selected ? "has-conversation" : ""} ${details ? "has-details" : ""}`}
      style={
        {
          "--sidebar-width": `${Math.min(440, Math.max(300, paneWidth + 24))}px`,
        } as CSSProperties
      }
    >
      <nav className="app-rail" aria-label="Main navigation">
        <span className="signal-mark rail-brand">
          <Icon name="chat" size={24} />
        </span>
        <button
          type="button"
          className={`rail-button ${filter !== "archive" ? "active" : ""}`}
          title="Conversations"
          aria-label="Conversations"
          onClick={() => {
            setFilter("all");
            setSelectedId(null);
            setDetails(false);
          }}
        >
          <Icon name="chat" size={22} />
          {unreadCount > 0 && <span className="rail-dot" />}
        </button>
        <button
          type="button"
          className={`rail-button ${filter === "archive" ? "active" : ""}`}
          title="Archived conversations"
          aria-label="Archived conversations"
          onClick={() => {
            setFilter("archive");
            setSelectedId(null);
            setDetails(false);
          }}
        >
          <Icon name="archive" size={22} />
        </button>
        <span className="rail-spacer" />
        <button
          type="button"
          className="rail-button"
          aria-label="Settings"
          title="Settings"
          onClick={() => setSettings(true)}
        >
          <Icon name="settings" size={22} />
        </button>
        <button
          type="button"
          className="rail-profile"
          aria-label="Your profile"
          title="Your profile"
          onClick={() => setSettings(true)}
        >
          <Avatar
            name={me.display_name}
            color={me.avatar_color}
            url={me.avatar_url}
            size={34}
          />
        </button>
      </nav>
      <aside className="app-sidebar">
        <header className="sidebar-header">
          <div>
            <h1>{filter === "archive" ? "Archived" : "Chats"}</h1>
            <span className="sidebar-greeting">
              {filter === "archive"
                ? "A little quieter here"
                : `Good to see you, ${me.display_name.split(" ")[0]}`}
            </span>
          </div>
          <div className="sidebar-header-actions">
            <IconButton
              name="settings"
              label="Open settings"
              className="mobile-settings"
              onClick={() => setSettings(true)}
            />
            <IconButton
              name="compose"
              label="New conversation"
              onClick={() => setNewChat(true)}
            />
          </div>
        </header>
        <div className="sidebar-tools">
          <label className="search-field">
            <Icon name="search" size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search all conversations"
              maxLength={200}
              autoComplete="off"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </label>
          <div className="sidebar-filters">
            <button
              type="button"
              className={filter === "all" ? "selected" : ""}
              onClick={() => {
                setFilter("all");
                setQuery("");
              }}
            >
              All
            </button>
            <button
              type="button"
              className={filter === "unread" ? "selected" : ""}
              onClick={() => {
                setFilter("unread");
                setQuery("");
              }}
            >
              Unread{unreadCount > 0 && <span>{unreadCount}</span>}
            </button>
            <button
              type="button"
              className={filter === "archive" ? "selected" : ""}
              onClick={() => {
                setFilter("archive");
                setQuery("");
              }}
            >
              Archived{archiveCount > 0 && <span>{archiveCount}</span>}
            </button>
          </div>
        </div>
        {socketStatus !== "open" && (
          <button
            type="button"
            className="connection-banner"
            onClick={() => socket.kick()}
          >
            <span className="connection-dot" />
            {socketStatus === "connecting"
              ? "Connecting…"
              : "Connection interrupted · Retry"}
          </button>
        )}
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
            <SearchPanel
              query={query}
              pending={search.query !== query}
              results={search.results}
              error={search.query === query ? search.error : ""}
              busy={busy}
              onRetry={() => {
                setSearch({ query: "", results: null, error: "" });
                setSearchAttempt((value) => value + 1);
              }}
              onConversation={(c) => {
                useChat.getState().upsertConversation(c);
                setFilter(c.is_archived ? "archive" : "all");
                select(c.id);
              }}
              onPerson={(user) => {
                if (!busy) void person(user);
              }}
              onMessage={(msg) => {
                if (!busy) void openMessage(msg);
              }}
            />
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
                  <p className="section-label conversation-section">PINNED</p>
                )}
                {!c.is_pinned && visible[index - 1]?.is_pinned && (
                  <p className="section-label conversation-section">RECENT</p>
                )}
                <ConversationRow
                  conversation={c}
                  selected={c.id === selectedId}
                  onSelect={() => select(c.id)}
                  onMenu={openMenu}
                />
              </div>
            ))
          ) : (
            <div className="sidebar-state">
              <Icon
                name={filter === "archive" ? "archive" : "chat"}
                size={34}
              />
              <p>
                {filter === "unread"
                  ? "You’re all caught up"
                  : filter === "archive"
                    ? "No archived conversations"
                    : "Your conversations start here"}
              </p>
              <small>
                {filter === "unread"
                  ? "New messages will appear here."
                  : "Start a conversation with someone you know."}
              </small>
              {filter === "all" && (
                <Button variant="secondary" onClick={() => setNewChat(true)}>
                  New conversation
                </Button>
              )}
            </div>
          )}
          <ErrorText>{actionError}</ErrorText>
        </div>
        <footer className="sidebar-footer">
          <Icon name="lock" size={13} />
          <span>Your local space to stay connected</span>
          <span
            className="sidebar-status-dot"
            data-online={socketStatus === "open"}
          />
        </footer>
      </aside>
      <section className="app-conversation" aria-label="Messages">
        {selected ? (
          <ChatPane
            key={selected.id}
            conversationId={selected.id}
            onBack={() => {
              setSelectedId(null);
              setDetails(false);
            }}
            onDetails={() => setDetails((prev) => !prev)}
          />
        ) : (
          <div className="welcome-pane">
            <div className="welcome-illustration">
              <div className="welcome-ring" />
              <span className="signal-mark welcome-mark">
                <Icon name="chat" size={54} />
              </span>
              <span className="welcome-small-bubble">
                <Icon name="smile" size={26} />
              </span>
              <span className="welcome-spark">✦</span>
            </div>
            <span className="welcome-eyebrow">
              MAKE TIME FOR A CONVERSATION
            </span>
            <h2>A hello goes a long way.</h2>
            <p>
              Select a chat to pick up where you left off,
              <br />
              or start a new conversation.
            </p>
            <Button onClick={() => setNewChat(true)}>
              <Icon name="compose" size={18} />
              New conversation
            </Button>
            <div className="welcome-local">
              <Icon name="shield" size={16} />
              Signal-inspired. Made for your local workspace.
            </div>
          </div>
        )}
      </section>
      {details && selected && (
        <ConversationDetails
          key={selected.id}
          conversationId={selected.id}
          onClose={() => setDetails(false)}
          onRemoved={() => {
            setSelectedId(null);
            setDetails(false);
          }}
        />
      )}{" "}
      {newChat && (
        <NewChat
          onClose={() => setNewChat(false)}
          onCreated={(id) => {
            const created = useChat.getState().conversations[id];
            setFilter(created?.is_archived ? "archive" : "all");
            select(id);
            setNewChat(false);
          }}
        />
      )}{" "}
      {settings && <Settings onClose={() => setSettings(false)} />}
      {menu && (
        <>
          <button
            className="menu-scrim"
            aria-label="Close conversation menu"
            type="button"
            onClick={() => setMenu(null)}
          />
          <div
            ref={menuRef}
            className="conversation-context-menu ui-menu"
            style={{
              left: menuPosition.left,
              top: menuPosition.top,
              right: "auto",
            }}
            role="menu"
            aria-label={`Options for ${menu.name}`}
            onKeyDown={(event) => {
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
                return;
              event.preventDefault();
              const items = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              );
              const index = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        items.length) %
                      items.length;
              items[next]?.focus();
            }}
          >
            <strong>{menu.peer?.nickname || menu.name}</strong>
            <button
              role="menuitem"
              type="button"
              disabled={busy || menu.is_archived}
              onClick={() => void menuAction({ is_pinned: !menu.is_pinned })}
            >
              <Icon name="pin" size={17} />
              {menu.is_pinned ? "Unpin" : "Pin"} conversation
            </button>
            <button
              role="menuitem"
              type="button"
              disabled={busy}
              onClick={() =>
                void menuAction({ is_archived: !menu.is_archived })
              }
            >
              <Icon name="archive" size={17} />
              {menu.is_archived ? "Unarchive" : "Archive"}
            </button>
            <button
              role="menuitem"
              type="button"
              disabled={busy}
              onClick={() => void toggleRead()}
            >
              <Icon name="chat" size={17} />
              {menu.unread_count > 0 || menu.marked_unread
                ? "Mark as read"
                : "Mark as unread"}
            </button>
            <button
              role="menuitem"
              type="button"
              disabled={busy}
              onClick={() =>
                void menuAction({
                  mute_seconds:
                    menu.muted_until &&
                    new Date(menu.muted_until).getTime() > now
                      ? 0
                      : -1,
                })
              }
            >
              <Icon name="bell-off" size={17} />
              {menu.muted_until && new Date(menu.muted_until).getTime() > now
                ? "Unmute"
                : "Mute"}{" "}
              notifications
            </button>
            <button
              role="menuitem"
              type="button"
              disabled={busy}
              onClick={() => {
                select(menu.id);
                setDetails(true);
              }}
            >
              <Icon name="info" size={17} />
              Conversation details
            </button>
            <ErrorText>{actionError}</ErrorText>
          </div>
        </>
      )}
    </main>
  );
}
