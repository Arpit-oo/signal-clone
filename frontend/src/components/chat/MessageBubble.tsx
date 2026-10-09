"use client";

/* eslint-disable @next/next/no-img-element -- Authenticated media and local blob previews are loaded directly. */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar, Icon } from "@/components/ui";
import { fileUrl } from "@/lib/api";
import type { Attachment, ChatMessage, User } from "@/lib/types";
import { displayName } from "@/stores/chat";
import { formatBytes, formatDuration } from "./helpers";
import { useContextMenuGesture } from "@/hooks/useContextMenuGesture";

export type MessageAction =
  "reply" | "edit" | "delete" | "forward" | "info" | "copy";

function MediaAttachment({
  attachment,
  onImage,
}: {
  attachment: Attachment;
  onImage: (attachment: Attachment) => void;
}) {
  const [failed, setFailed] = useState(false);
  const url = fileUrl(attachment.url);
  if (failed)
    return (
      <a className="chat-file" href={url} target="_blank" rel="noreferrer">
        <Icon name="alert" />
        <span>
          Preview unavailable<strong>{attachment.file_name}</strong>
        </span>
        <Icon name="download" />
      </a>
    );
  if (attachment.kind === "image")
    return (
      <button
        className="chat-image-button"
        onClick={() => onImage(attachment)}
        aria-label={`View ${attachment.file_name}`}
      >
        <img
          className="chat-image"
          src={url}
          alt={attachment.file_name}
          width={attachment.width ?? 320}
          height={attachment.height ?? 240}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </button>
    );
  if (attachment.kind === "video")
    return (
      <video
        className="chat-video"
        src={url}
        controls
        preload="metadata"
        onError={() => setFailed(true)}
        aria-label={attachment.file_name}
      />
    );
  if (attachment.kind === "audio" || attachment.kind === "voice")
    return (
      <div className="chat-audio">
        <div className="chat-audio-caption">
          <Icon name={attachment.kind === "voice" ? "mic" : "file"} size={16} />
          <span>
            {attachment.kind === "voice"
              ? "Voice message"
              : attachment.file_name}
          </span>
          {attachment.duration_ms !== null && (
            <span>{formatDuration(attachment.duration_ms)}</span>
          )}
        </div>
        <audio
          controls
          src={url}
          preload="metadata"
          onError={() => setFailed(true)}
          aria-label={
            attachment.kind === "voice" ? "Voice message" : attachment.file_name
          }
        />
      </div>
    );
  return (
    <a
      className="chat-file"
      href={url}
      target="_blank"
      rel="noreferrer"
      download={attachment.file_name}
    >
      <Icon name="file" size={28} />
      <span>
        <strong>{attachment.file_name}</strong>
        <small>{formatBytes(attachment.size_bytes)}</small>
      </span>
      <Icon name="download" size={18} />
    </a>
  );
}

function MessageText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s<>]+)/g).map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a key={index} href={part} target="_blank" rel="noreferrer">
            {part}
          </a>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

export function MessageBubble({
  message,
  own,
  grouped,
  groupChat,
  sender,
  users,
  meId,
  focused,
  onAction,
  onReact,
  onJump,
  onImage,
  onRetry,
  onDiscard,
  reactionBusy,
}: {
  message: ChatMessage;
  own: boolean;
  grouped: boolean;
  groupChat: boolean;
  sender?: User;
  users: Record<number, User>;
  meId: number | null;
  focused: boolean;
  onAction: (action: MessageAction, message: ChatMessage) => void;
  onReact: (message: ChatMessage, emoji: string) => void;
  onJump: (id: number) => void;
  onImage: (attachment: Attachment) => void;
  onRetry: (clientId: string) => void;
  onDiscard: (clientId: string) => void;
  reactionBusy: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [recent, setRecent] = useState(
    () => Date.now() - new Date(message.created_at).getTime() < 86400000,
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const closeMenu = useCallback((restoreFocus = false) => {
    setMenu(false);
    if (restoreFocus)
      menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);
  useEffect(() => {
    if (!menu) return;
    function dismiss(event: MouseEvent) {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !panelRef.current?.contains(event.target as Node)
      )
        closeMenu();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
      }
    }
    function moved(event: Event) {
      if (
        event.type === "scroll" &&
        panelRef.current?.contains(event.target as Node)
      )
        return;
      closeMenu();
    }
    function focusChanged(event: FocusEvent) {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !panelRef.current?.contains(event.target as Node)
      )
        closeMenu();
    }
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", escape);
    document.addEventListener("scroll", moved, true);
    document.addEventListener("focusin", focusChanged);
    window.addEventListener("resize", moved);
    const frame = requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus(),
    );
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("scroll", moved, true);
      document.removeEventListener("focusin", focusChanged);
      window.removeEventListener("resize", moved);
    };
  }, [menu, closeMenu]);
  const reactions = [
    ...new Set(message.reactions.map((reaction) => reaction.emoji)),
  ];
  const confirmed = message.id > 0;
  const action = (name: MessageAction) => {
    closeMenu(true);
    onAction(name, message);
  };
  function openMenu(anchor: HTMLElement) {
    setRecent(Date.now() - new Date(message.created_at).getTime() < 86400000);
    const bounds = anchor.getBoundingClientRect();
    const menuWidth =
      window.innerWidth <= 760 ? Math.min(288, window.innerWidth - 24) : 228;
    const estimatedHeight = message.is_deleted
      ? own
        ? 92
        : 52
      : own
        ? 340
        : 270;
    setMenuPosition({
      left: Math.max(
        12,
        Math.min(
          window.innerWidth - menuWidth - 12,
          own ? bounds.right - menuWidth : bounds.left,
        ),
      ),
      top:
        bounds.top > estimatedHeight + 12
          ? bounds.top - estimatedHeight - 6
          : Math.max(
              12,
              Math.min(
                window.innerHeight - estimatedHeight - 12,
                bounds.bottom + 6,
              ),
            ),
    });
    setMenu(true);
  }
  const menuGesture = useContextMenuGesture(openMenu, !confirmed);
  const status = message.status;
  return (
    <article
      id={`chat-message-${message.id}`}
      className={`chat-message-row ${own ? "chat-own" : "chat-incoming"} ${grouped ? "chat-grouped" : ""} ${focused ? "chat-focused" : ""}`}
      aria-label={`${own ? "You" : displayName(sender)}: ${message.is_deleted ? "Deleted message" : message.body || "Attachment"}`}
    >
      {groupChat && !own && (
        <div className="chat-sender-avatar">
          {!grouped && (
            <Avatar
              name={displayName(sender)}
              color={sender?.avatar_color}
              url={sender?.avatar_url}
              size={28}
            />
          )}
        </div>
      )}
      <div className="chat-message-stack">
        <div
          {...menuGesture}
          className={`chat-bubble ${message.is_deleted ? "chat-deleted" : ""} ${!message.is_deleted && !message.attachments.length && !message.localAttachments?.length ? "chat-bubble-text" : ""}`}
        >
          {groupChat && !own && !grouped && (
            <div
              className="chat-sender-name"
              data-color={(message.sender_id ?? 0) % 8}
            >
              {displayName(sender)}
            </div>
          )}
          {message.is_forwarded && !message.is_deleted && (
            <div className="chat-forwarded">
              <Icon name="forward" size={12} />
              Forwarded
            </div>
          )}
          {message.reply_to && !message.is_deleted && (
            <button
              className="chat-reply-preview"
              onClick={() => onJump(message.reply_to!.id)}
            >
              <strong>
                {message.reply_to.sender_id === meId
                  ? "You"
                  : displayName(
                      message.reply_to.sender_id
                        ? users[message.reply_to.sender_id]
                        : null,
                    )}
              </strong>
              <span>
                {message.reply_to.is_deleted
                  ? "This message was deleted"
                  : message.reply_to.body ||
                    `${message.reply_to.attachment_kind ?? "Message"} attachment`}
              </span>
            </button>
          )}
          {message.is_deleted ? (
            <p className="chat-message-body message-text">
              <Icon name="trash" size={14} />
              This message was deleted
            </p>
          ) : (
            <>
              {message.attachments.map((attachment) => (
                <MediaAttachment
                  key={attachment.id}
                  attachment={attachment}
                  onImage={onImage}
                />
              ))}
              {message.attachments.length === 0 &&
                message.localAttachments?.map((attachment, index) => (
                  <div key={index} className="chat-local-attachment">
                    {attachment.previewUrl ? (
                      <img
                        src={attachment.previewUrl}
                        alt={attachment.name}
                        className="chat-image"
                      />
                    ) : (
                      <>
                        <Icon
                          name={attachment.kind === "voice" ? "mic" : "file"}
                        />
                        <span>{attachment.name}</span>
                      </>
                    )}
                    <small>
                      {status === "failed" ? "Upload failed" : "Uploading…"}
                    </small>
                  </div>
                ))}
              {message.body && (
                <p className="chat-message-body message-text">
                  <MessageText text={message.body} />
                </p>
              )}
            </>
          )}
          <div className="chat-message-meta">
            {message.expires_in_seconds && (
              <span
                title={`Disappearing message${message.expires_at ? ` · Expires ${new Date(message.expires_at).toLocaleString()}` : ""}`}
              >
                <Icon name="clock" size={11} />
              </span>
            )}
            {message.edited_at && (
              <span
                title={`Edited ${new Date(message.edited_at).toLocaleString()}`}
              >
                Edited
              </span>
            )}
            <time
              dateTime={message.created_at}
              title={new Date(message.created_at).toLocaleString()}
            >
              {new Date(message.created_at).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </time>
            {own && status && (
              <span
                className={`chat-receipt chat-receipt-${status}`}
                title={
                  status === "read"
                    ? "Read"
                    : status === "delivered"
                      ? "Delivered"
                      : status === "sent"
                        ? "Sent"
                        : status === "failed"
                          ? "Failed to send"
                          : "Sending"
                }
                aria-label={status}
              >
                <Icon
                  name={
                    status === "sending"
                      ? "clock"
                      : status === "failed"
                        ? "alert"
                        : status === "sent"
                          ? "check"
                          : "double-check"
                  }
                  size={15}
                />
              </span>
            )}
          </div>
        </div>
        {reactions.length > 0 && (
          <div className="chat-reactions">
            {reactions.map((emoji) => {
              const matching = message.reactions.filter(
                (reaction) => reaction.emoji === emoji,
              );
              const mine = matching.some(
                (reaction) => reaction.user_id === meId,
              );
              return (
                <button
                  key={emoji}
                  className={
                    mine ? "chat-reaction chat-reaction-mine" : "chat-reaction"
                  }
                  disabled={reactionBusy}
                  onClick={() => onReact(message, emoji)}
                  title={matching
                    .map((reaction) =>
                      reaction.user_id === meId
                        ? "You"
                        : displayName(users[reaction.user_id]),
                    )
                    .join(", ")}
                  aria-label={`${emoji}, ${matching.length} reaction${matching.length > 1 ? "s" : ""}${mine ? ", selected" : ""}`}
                  aria-pressed={mine}
                >
                  {emoji}
                  {matching.length > 1 && <span>{matching.length}</span>}
                </button>
              );
            })}
          </div>
        )}
        {status === "failed" && message.client_id && (
          <div className="chat-send-failed">
            <span>{message.failureReason || "Couldn’t send"}</span>
            <button onClick={() => onRetry(message.client_id!)}>Retry</button>
            <button onClick={() => onDiscard(message.client_id!)}>
              Remove
            </button>
          </div>
        )}
      </div>
      {confirmed && (
        <div
          className={`chat-message-actions ${menu ? "chat-actions-open" : ""}`}
          ref={menuRef}
        >
          <button
            className="chat-icon-button chat-more-button"
            aria-label="Message actions"
            aria-expanded={menu}
            aria-haspopup="menu"
            aria-controls={menu ? menuId : undefined}
            onClick={(event) => {
              if (menu) closeMenu();
              else openMenu(event.currentTarget);
            }}
          >
            <Icon name="more" size={18} />
          </button>
          {menu &&
            createPortal(
              <div
                className="chat-action-menu"
                role="menu"
                id={menuId}
                aria-label="Message actions"
                ref={panelRef}
                style={{ top: menuPosition.top, left: menuPosition.left }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    closeMenu(true);
                    return;
                  }
                  if (event.key === "Tab") {
                    event.preventDefault();
                    const trigger =
                      menuRef.current?.querySelector<HTMLButtonElement>(
                        "button",
                      );
                    const focusable = Array.from(
                      document.querySelectorAll<HTMLElement>(
                        "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex='0']",
                      ),
                    ).filter(
                      (element) =>
                        !panelRef.current?.contains(element) &&
                        element.getClientRects().length > 0,
                    );
                    const index = trigger ? focusable.indexOf(trigger) : -1;
                    closeMenu();
                    (
                      focusable[index + (event.shiftKey ? -1 : 1)] ?? trigger
                    )?.focus();
                    return;
                  }
                  if (
                    ![
                      "ArrowDown",
                      "ArrowUp",
                      "ArrowLeft",
                      "ArrowRight",
                      "Home",
                      "End",
                    ].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  const buttons = Array.from(
                    event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      "button:not(:disabled)",
                    ),
                  );
                  const index = buttons.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  if (event.key === "Home") {
                    buttons[0]?.focus();
                    return;
                  }
                  if (event.key === "End") {
                    buttons.at(-1)?.focus();
                    return;
                  }
                  buttons[
                    (index +
                      (event.key === "ArrowDown" || event.key === "ArrowRight"
                        ? 1
                        : -1) +
                      buttons.length) %
                      buttons.length
                  ]?.focus();
                }}
              >
                {!message.is_deleted && (
                  <div
                    className="chat-quick-reactions"
                    role="group"
                    aria-label="Quick reactions"
                  >
                    {["❤️", "👍", "😂", "😮", "😢", "🙏"].map((emoji) => (
                      <button
                        key={emoji}
                        role="menuitem"
                        aria-label={`React with ${emoji}`}
                        disabled={reactionBusy}
                        onClick={() => {
                          closeMenu(true);
                          onReact(message, emoji);
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
                {!message.is_deleted && (
                  <button role="menuitem" onClick={() => action("reply")}>
                    <Icon name="reply" size={17} />
                    Reply
                  </button>
                )}
                {!!message.body && !message.is_deleted && (
                  <button role="menuitem" onClick={() => action("copy")}>
                    <Icon name="copy" size={17} />
                    Copy text
                  </button>
                )}
                {own && recent && !!message.body && !message.is_deleted && (
                  <button role="menuitem" onClick={() => action("edit")}>
                    <Icon name="edit" size={17} />
                    Edit message
                  </button>
                )}
                {!message.is_deleted && (
                  <button role="menuitem" onClick={() => action("forward")}>
                    <Icon name="forward" size={17} />
                    Forward
                  </button>
                )}
                {own && (
                  <button role="menuitem" onClick={() => action("info")}>
                    <Icon name="info" size={17} />
                    Message info
                  </button>
                )}
                <button
                  role="menuitem"
                  className="chat-destructive"
                  onClick={() => action("delete")}
                >
                  <Icon name="trash" size={17} />
                  Delete
                </button>
              </div>,
              document.body,
            )}
        </div>
      )}
    </article>
  );
}
