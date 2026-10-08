"use client";

/* eslint-disable @next/next/no-img-element -- Authenticated image originals are viewed without transformation. */

import { useEffect, useState } from "react";
import { Avatar, Icon, Modal } from "@/components/ui";
import { api, fileUrl } from "@/lib/api";
import type { Attachment, ChatMessage, MessageInfo } from "@/lib/types";
import { displayName, sortConversations, useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { errorMessage } from "./helpers";

export function ImageDialog({
  attachment,
  onClose,
}: {
  attachment: Attachment;
  onClose: () => void;
}) {
  return (
    <Modal title={attachment.file_name} onClose={onClose}>
      <div className="chat-image-viewer">
        <img src={fileUrl(attachment.url)} alt={attachment.file_name} />
        <a
          className="chat-button"
          href={fileUrl(attachment.url)}
          download={attachment.file_name}
          target="_blank"
          rel="noreferrer"
        >
          <Icon name="download" size={17} />
          Download
        </a>
      </div>
    </Modal>
  );
}

export function InfoDialog({
  message,
  onClose,
}: {
  message: ChatMessage;
  onClose: () => void;
}) {
  const [info, setInfo] = useState<MessageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const users = useChat((state) => state.users);
  useEffect(() => {
    let active = true;
    api.messages
      .info(message.id)
      .then((result) => {
        if (active) setInfo(result);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [message.id, attempt]);
  return (
    <Modal title="Message info" onClose={onClose}>
      <div className="chat-info-dialog">
        <p className="chat-info-body">
          {message.is_deleted
            ? "This message was deleted"
            : message.body || "Attachment"}
        </p>
        <dl className="chat-info-times">
          <div>
            <dt>Sent</dt>
            <dd>{new Date(message.created_at).toLocaleString()}</dd>
          </div>
          {message.edited_at && (
            <div>
              <dt>Edited</dt>
              <dd>{new Date(message.edited_at).toLocaleString()}</dd>
            </div>
          )}
          {message.expires_at && (
            <div>
              <dt>Expires</dt>
              <dd>{new Date(message.expires_at).toLocaleString()}</dd>
            </div>
          )}
        </dl>
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
        {!info && !error && (
          <p className="chat-loading" role="status">
            Loading delivery details…
          </p>
        )}
        {info && (
          <>
            <h3>Recipients</h3>
            {info.recipients.length === 0 && (
              <p className="chat-muted">No delivery receipts yet.</p>
            )}
            {info.recipients.map((recipient) => {
              const user = users[recipient.user_id];
              return (
                <div className="chat-recipient" key={recipient.user_id}>
                  <Avatar
                    name={displayName(user)}
                    color={user?.avatar_color}
                    url={user?.avatar_url}
                    size={36}
                  />
                  <div>
                    <strong>{displayName(user)}</strong>
                    {recipient.read_at ? (
                      <small>
                        Read · {new Date(recipient.read_at).toLocaleString()}
                      </small>
                    ) : recipient.delivered_at ? (
                      <small>
                        Delivered ·{" "}
                        {new Date(recipient.delivered_at).toLocaleString()}
                      </small>
                    ) : (
                      <small>Sent · Awaiting delivery</small>
                    )}
                  </div>
                  <Icon
                    name={
                      recipient.delivered_at || recipient.read_at
                        ? "double-check"
                        : "check"
                    }
                    size={18}
                  />
                </div>
              );
            })}
          </>
        )}
      </div>
    </Modal>
  );
}

export function DeleteDialog({
  message,
  onClose,
}: {
  message: ChatMessage;
  onClose: () => void;
}) {
  const me = useSession((state) => state.me);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent] = useState(
    () => Date.now() - new Date(message.created_at).getTime() < 86400000,
  );
  const canDeleteEveryone =
    me?.id === message.sender_id && !message.is_deleted && recent;
  async function remove(scope: "me" | "everyone") {
    setBusy(true);
    setError(null);
    try {
      await api.messages.remove(message.id, scope);
      if (scope === "me")
        useChat
          .getState()
          .handleEvent({
            type: "message.hidden",
            data: {
              message_id: message.id,
              conversation_id: message.conversation_id,
            },
          });
      else
        useChat
          .getState()
          .handleEvent({
            type: "message.updated",
            data: {
              ...message,
              status:
                message.status === "sending" || message.status === "failed"
                  ? null
                  : message.status,
              body: "",
              is_deleted: true,
              attachments: [],
              reactions: [],
            },
          });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }
  return (
    <Modal title="Delete message?" onClose={busy ? () => {} : onClose}>
      <div className="chat-dialog-content">
        <p>
          Delete for you removes this message from your conversation history.
        </p>
        {canDeleteEveryone && (
          <p className="chat-muted">
            Delete for everyone replaces this message with a deletion notice for
            all participants.
          </p>
        )}
        {error && (
          <p className="chat-inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="chat-dialog-actions">
          <button className="chat-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="chat-button chat-danger-button"
            disabled={busy}
            onClick={() => void remove("me")}
          >
            Delete for me
          </button>
          {canDeleteEveryone && (
            <button
              className="chat-button chat-danger-button"
              disabled={busy}
              onClick={() => void remove("everyone")}
            >
              Delete for everyone
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function ForwardDialog({
  message,
  onClose,
}: {
  message: ChatMessage;
  onClose: () => void;
}) {
  const conversations = useChat((state) => state.conversations);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = sortConversations(Object.values(conversations)).filter(
    (conversation) =>
      conversation.is_member &&
      !conversation.peer?.is_blocked &&
      conversation.name.toLowerCase().includes(query.toLowerCase()),
  );
  async function forward() {
    setBusy(true);
    setError(null);
    try {
      const messages = await api.messages.forward(
        message.id,
        selected,
        note.trim() || undefined,
      );
      for (const forwarded of messages)
        useChat
          .getState()
          .handleEvent({ type: "message.new", data: forwarded });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }
  return (
    <Modal title="Forward message" onClose={busy ? () => {} : onClose}>
      <div className="chat-forward-dialog">
        <p className="chat-info-body">
          {message.body ||
            `${message.attachments.length} attachment${message.attachments.length === 1 ? "" : "s"}`}
        </p>
        <label className="chat-field">
          <span>Choose conversations</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations"
            autoFocus
            disabled={busy}
          />
        </label>
        <div className="chat-forward-list">
          {choices.map((conversation) => (
            <label className="chat-forward-choice" key={conversation.id}>
              <input
                type="checkbox"
                checked={selected.includes(conversation.id)}
                disabled={
                  busy ||
                  (selected.length >= 20 && !selected.includes(conversation.id))
                }
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, conversation.id]
                      : current.filter((id) => id !== conversation.id),
                  )
                }
              />
              <Avatar
                name={conversation.name}
                color={conversation.avatar_color}
                url={conversation.avatar_url}
                size={38}
              />
              <span>
                {conversation.name}
                <small>
                  {conversation.type === "group"
                    ? `${conversation.member_count} members`
                    : conversation.type === "note_to_self"
                      ? "Your private notes"
                      : conversation.peer?.phone}
                </small>
              </span>
            </label>
          ))}
          {choices.length === 0 && (
            <p className="chat-muted">No matching conversations.</p>
          )}
        </div>
        <label className="chat-field">
          <span>Add a note (optional)</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={8000}
            rows={2}
            disabled={busy}
          />
        </label>
        {error && (
          <p className="chat-inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="chat-dialog-actions">
          <small>{selected.length} / 20 selected</small>
          <button className="chat-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="chat-button chat-primary-button"
            disabled={!selected.length || busy}
            onClick={() => void forward()}
          >
            {busy ? "Forwarding…" : "Forward"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
