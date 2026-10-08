"use client";

import type { Conversation } from "@/lib/types";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { Avatar, Icon, Spinner, useNow } from "@/components/ui";
import { conversationPreview, timeLabel } from "./conversationFormatting";

export default function ConversationRow({
  conversation: c,
  selected,
  onSelect,
  onMenu,
  onPin,
  pinning,
  pinDisabled,
}: {
  conversation: Conversation;
  selected: boolean;
  onSelect: () => void;
  onMenu: (c: Conversation, anchor: HTMLElement) => void;
  onPin: (c: Conversation) => void;
  pinning: boolean;
  pinDisabled: boolean;
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
      className={`conversation-row ${selected ? "selected" : ""} ${unread ? "unread" : ""} ${c.is_pinned ? "pinned" : ""}`}
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
              {typing?.length ? "Typing…" : conversationPreview(c, meId)}
            </span>
            <span className="conversation-badges">
              {muted && <Icon name="bell-off" size={14} />}{" "}
              {unread && (
                <span className={`unread-badge ${muted ? "muted" : ""}`}>
                  {c.mention_count ? "@" : c.unread_count || ""}
                </span>
              )}
            </span>
          </span>
        </span>
      </button>
      {!c.is_archived && (
        <button
          type="button"
          className={`conversation-pin-trigger ${c.is_pinned ? "is-pinned" : ""}`}
          aria-label={`${c.is_pinned ? "Unpin" : "Pin"} ${name}`}
          aria-pressed={c.is_pinned}
          title={
            c.is_pinned ? "Unpin conversation" : "Pin conversation to the top"
          }
          disabled={pinDisabled}
          onClick={() => onPin(c)}
        >
          {pinning ? (
            <Spinner label="Saving pin" />
          ) : (
            <Icon name="pin" size={16} />
          )}
        </button>
      )}
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
