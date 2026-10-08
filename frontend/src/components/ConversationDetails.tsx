"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import type { ConversationDetail, User } from "@/lib/types";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import NewChat from "./NewChat";
import {
  Avatar,
  Button,
  ErrorText,
  Icon,
  IconButton,
  Modal,
  Spinner,
  errorMessage,
  useNow,
} from "./ui";

const timers = [
  { seconds: 0, label: "Off" },
  { seconds: 30, label: "30 seconds" },
  { seconds: 300, label: "5 minutes" },
  { seconds: 3600, label: "1 hour" },
  { seconds: 28800, label: "8 hours" },
  { seconds: 86400, label: "1 day" },
  { seconds: 604800, label: "1 week" },
  { seconds: 2419200, label: "4 weeks" },
];
type Confirmation = {
  title: string;
  text: string;
  label: string;
  action: () => Promise<void>;
};

export default function ConversationDetails({
  conversationId,
  onClose,
  onRemoved,
}: {
  conversationId: number;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const now = useNow();
  const conversation = useChat((s) => s.conversations[conversationId]);
  const detail = useChat((s) => s.details[conversationId]);
  const peerOverride = useChat((s) =>
    conversation?.peer ? s.users[conversation.peer.id] : undefined,
  );
  const me = useSession((s) => s.me)!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [addMembers, setAddMembers] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nickname, setNickname] = useState(
    peerOverride?.nickname ?? conversation?.peer?.nickname ?? "",
  );
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  useEffect(() => {
    let active = true;
    useChat
      .getState()
      .loadDetail(conversationId)
      .then((result) => {
        if (active) {
          setLoaded(true);
          if (!result)
            setLoadError("Couldn’t load conversation details. Try again.");
        }
      });
    return () => {
      active = false;
    };
  }, [conversationId]);
  async function retryDetails() {
    setLoaded(false);
    setLoadError("");
    const result = await useChat.getState().loadDetail(conversationId);
    setLoaded(true);
    if (!result) setLoadError("Couldn’t load conversation details. Try again.");
  }
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function refresh(updated?: ConversationDetail) {
    if (updated) {
      useChat.setState((state) => ({
        details: { ...state.details, [conversationId]: updated },
      }));
      useChat
        .getState()
        .rememberUsers(updated.members.map((member) => member.user));
      useChat.getState().upsertConversation(updated);
      setLoadError("");
    } else {
      const result = await useChat.getState().loadDetail(conversationId);
      setLoadError(
        result
          ? ""
          : "Changes were saved, but details couldn’t be refreshed. Try again.",
      );
    }
  }
  async function settings(patch: {
    is_pinned?: boolean;
    is_archived?: boolean;
    marked_unread?: boolean;
    mute_seconds?: number;
  }) {
    useChat
      .getState()
      .upsertConversation(
        await api.conversations.settings(conversationId, patch),
      );
  }
  async function contact(user: User, action: "add" | "remove" | "rename") {
    let updated: User;
    if (action === "remove") {
      await api.contacts.remove(user.id);
      updated = { ...user, is_contact: false, nickname: null };
    } else
      updated =
        action === "add"
          ? await api.contacts.add({ user_id: user.id })
          : await api.contacts.rename(user.id, nickname.trim() || null);
    useChat.getState().rememberUsers([updated]);
    setNickname(updated.nickname ?? "");
    for (const current of Object.values(useChat.getState().conversations)) {
      if (current.peer?.id === updated.id)
        useChat.getState().upsertConversation({
          ...current,
          peer: updated,
          name: updated.nickname || updated.display_name,
        });
    }
    await useChat.getState().loadConversations();
    await refresh();
  }
  async function block(user: User) {
    if (user.is_blocked) {
      await api.blocks.unblock(user.id);
      useChat.getState().rememberUsers([{ ...user, is_blocked: false }]);
    } else useChat.getState().rememberUsers([await api.blocks.block(user.id)]);
    await useChat.getState().loadConversations();
    await refresh();
  }
  async function saveGroup(event: FormEvent) {
    event.preventDefault();
    await act(async () => {
      await refresh(
        await api.conversations.update(conversationId, {
          name: name.trim(),
          description: description.trim(),
        }),
      );
      setEditing(false);
    });
  }
  if (!conversation) return null;
  const peer = peerOverride ?? conversation.peer;
  const group = conversation.type === "group";
  const title =
    conversation.type === "note_to_self"
      ? "Note to Self"
      : peer?.nickname || conversation.name;
  const muted =
    !!conversation.muted_until &&
    new Date(conversation.muted_until).getTime() > now;
  return (
    <aside className="details-pane" aria-label="Conversation details">
      <header className="details-header">
        <h2>{group ? "Group details" : "Conversation details"}</h2>
        <IconButton name="close" label="Close details" onClick={onClose} />
      </header>
      <div className="details-content scroll-thin">
        <div className="details-profile">
          <Avatar
            name={title}
            color={peer?.avatar_color || conversation.avatar_color}
            url={peer?.avatar_url || conversation.avatar_url}
            size={86}
          />
          <h2>{title}</h2>
          <p>
            {group
              ? `${conversation.member_count} members`
              : peer?.phone || "Your personal space"}
          </p>
          {peer?.username && (
            <span className="username-tag">@{peer.username}</span>
          )}
          {peer?.about && (
            <p className="profile-about">
              {peer.about_emoji} {peer.about}
            </p>
          )}
          {group && conversation.description && (
            <p className="profile-about">{conversation.description}</p>
          )}
          {group && conversation.is_member && (
            <div className="details-profile-actions">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setName(conversation.name);
                  setDescription(conversation.description || "");
                  setEditing(true);
                }}
              >
                <Icon name="edit" size={16} />
                Edit group
              </Button>
              <label className="ui-button ui-button-secondary upload-button">
                <Icon name="image" size={16} />
                Photo
                <input
                  type="file"
                  accept="image/*"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      void act(async () => {
                        if (file.size > 10 * 1024 * 1024)
                          throw new Error(
                            "Choose an image smaller than 10 MB.",
                          );
                        await refresh(
                          await api.conversations.uploadAvatar(
                            conversationId,
                            file,
                          ),
                        );
                      });
                    e.target.value = "";
                  }}
                />
              </label>
              {conversation.avatar_url && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void act(async () =>
                      refresh(
                        await api.conversations.deleteAvatar(conversationId),
                      ),
                    )
                  }
                >
                  Remove photo
                </button>
              )}
            </div>
          )}
        </div>
        <ErrorText>{error}</ErrorText>
        {loadError && (
          <div className="details-load-error">
            <ErrorText>{loadError}</ErrorText>
            <Button
              variant="secondary"
              disabled={!loaded || busy}
              onClick={() => void retryDetails()}
            >
              {!loaded && <Spinner />}Retry details
            </Button>
          </div>
        )}
        {busy && (
          <div className="details-busy">
            <Spinner />
            Saving changes…
          </div>
        )}
        <section className="details-section">
          <h3>Conversation</h3>
          <div className="details-pin-row">
            <span>
              <strong>
                {conversation.is_pinned ? "Pinned to the top" : "Pin this chat"}
              </strong>
              <small>
                {conversation.is_archived
                  ? "Unarchive this conversation before pinning it."
                  : "Your pin is saved to your account and only changes your chat list."}
              </small>
            </span>
            <Button
              variant="secondary"
              disabled={busy || conversation.is_archived}
              onClick={() =>
                void act(() => settings({ is_pinned: !conversation.is_pinned }))
              }
            >
              <Icon name="pin" size={16} />
              {conversation.is_pinned
                ? "Unpin conversation"
                : "Pin conversation"}
            </Button>
          </div>
          <label className="ui-field detail-field">
            <span>
              <Icon name="bell" size={18} />
              Mute notifications
            </span>
            <select
              aria-label="Mute notifications"
              value={muted ? "muted" : "0"}
              disabled={busy}
              onChange={(e) =>
                void act(() =>
                  settings({ mute_seconds: Number(e.target.value) }),
                )
              }
            >
              {muted && <option value="muted">Muted</option>}
              <option value="0">Not muted</option>
              <option value="3600">For 1 hour</option>
              <option value="28800">For 8 hours</option>
              <option value="86400">For 1 day</option>
              <option value="604800">For 1 week</option>
              <option value="-1">Always</option>
            </select>
          </label>
          <label className="ui-field detail-field">
            <span>
              <Icon name="clock" size={18} />
              Disappearing messages
            </span>
            <select
              aria-label="Disappearing message timer"
              value={conversation.disappearing_seconds ?? 0}
              disabled={busy || !conversation.is_member}
              onChange={(e) =>
                void act(async () =>
                  refresh(
                    await api.conversations.update(conversationId, {
                      disappearing_seconds: Number(e.target.value) || null,
                    }),
                  ),
                )
              }
            >
              {timers.map((timer) => (
                <option key={timer.seconds} value={timer.seconds}>
                  {timer.label}
                </option>
              ))}
              {conversation.disappearing_seconds &&
                !timers.some(
                  (t) => t.seconds === conversation.disappearing_seconds,
                ) && (
                  <option value={conversation.disappearing_seconds}>
                    {conversation.disappearing_seconds} seconds
                  </option>
                )}
            </select>
            <small>
              New messages disappear after they’re read. Anyone in the
              conversation can change the timer.
            </small>
          </label>
        </section>
        {peer && (
          <section className="details-section">
            <h3>Contact</h3>
            {peer.is_contact ? (
              <>
                <form
                  className="nickname-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(() => contact(peer, "rename"));
                  }}
                >
                  <label className="ui-field">
                    Nickname
                    <input
                      value={nickname}
                      placeholder={peer.nickname || peer.display_name}
                      maxLength={64}
                      disabled={busy}
                      onChange={(e) => setNickname(e.target.value)}
                    />
                  </label>
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={busy || nickname.trim() === (peer.nickname ?? "")}
                  >
                    Save nickname
                  </Button>
                </form>
                <button
                  type="button"
                  className="detail-action"
                  disabled={busy}
                  onClick={() =>
                    setConfirmation({
                      title: "Remove contact?",
                      text: `${peer.display_name} will be removed from your contacts. Your conversation remains.`,
                      label: "Remove contact",
                      action: async () => contact(peer, "remove"),
                    })
                  }
                >
                  <Icon name="user" size={19} />
                  Remove from contacts
                </button>
              </>
            ) : (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void act(() => contact(peer, "add"))}
              >
                <Icon name="plus" size={17} />
                Add to contacts
              </Button>
            )}
            <button
              type="button"
              className="detail-action destructive"
              disabled={busy}
              onClick={() =>
                peer.is_blocked
                  ? void act(() => block(peer))
                  : setConfirmation({
                      title: `Block ${peer.display_name}?`,
                      text: "You won’t be able to exchange direct messages until you unblock this person.",
                      label: "Block",
                      action: async () => block(peer),
                    })
              }
            >
              <Icon name="block" size={19} />
              {peer.is_blocked ? "Unblock person" : "Block person"}
            </button>
          </section>
        )}
        {group && (
          <section className="details-section">
            <h3>
              Members <span>{conversation.member_count}</span>
              {conversation.my_role === "admin" && conversation.is_member && (
                <IconButton
                  name="plus"
                  label="Add members"
                  disabled={busy || !detail}
                  onClick={() => setAddMembers(true)}
                />
              )}
            </h3>
            {!loaded && !detail ? (
              <Spinner />
            ) : (
              detail?.members.map((member) => (
                <div className="group-member" key={member.user.id}>
                  <Avatar
                    name={member.user.nickname || member.user.display_name}
                    color={member.user.avatar_color}
                    url={member.user.avatar_url}
                    size={36}
                  />
                  <span className="person-info">
                    <strong>
                      {member.user.id === me.id
                        ? `${member.user.display_name} (you)`
                        : member.user.nickname || member.user.display_name}
                    </strong>
                    <small>
                      {member.role === "admin"
                        ? "Group admin"
                        : member.user.username
                          ? `@${member.user.username}`
                          : "Member"}
                    </small>
                  </span>
                  {conversation.my_role === "admin" &&
                    conversation.is_member &&
                    member.user.id !== me.id && (
                      <div className="member-actions">
                        <button
                          type="button"
                          disabled={busy}
                          className="text-button"
                          onClick={() =>
                            void act(async () =>
                              refresh(
                                await api.conversations.setRole(
                                  conversationId,
                                  member.user.id,
                                  member.role === "admin" ? "member" : "admin",
                                ),
                              ),
                            )
                          }
                        >
                          {member.role === "admin"
                            ? "Make member"
                            : "Make admin"}
                        </button>
                        <IconButton
                          name="close"
                          label={`Remove ${member.user.display_name}`}
                          disabled={busy}
                          onClick={() =>
                            setConfirmation({
                              title: "Remove member?",
                              text: `Remove ${member.user.display_name} from ${conversation.name}?`,
                              label: "Remove",
                              action: async () =>
                                refresh(
                                  await api.conversations.removeMember(
                                    conversationId,
                                    member.user.id,
                                  ),
                                ),
                            })
                          }
                        />
                      </div>
                    )}
                </div>
              ))
            )}
          </section>
        )}
        <section className="details-section">
          <button
            type="button"
            className="detail-action"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await settings({ is_archived: !conversation.is_archived });
                onClose();
              })
            }
          >
            <Icon name="archive" />
            {conversation.is_archived
              ? "Unarchive conversation"
              : "Archive conversation"}
          </button>
          <button
            type="button"
            className="detail-action"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await settings({ marked_unread: true });
                onRemoved();
              })
            }
          >
            <Icon name="chat" />
            Mark as unread
          </button>
          {group && conversation.is_member && (
            <button
              type="button"
              className="detail-action destructive"
              disabled={busy}
              onClick={() =>
                setConfirmation({
                  title: "Leave group?",
                  text: `You’ll stop receiving messages in ${conversation.name}. Your existing history remains.`,
                  label: "Leave group",
                  action: async () => {
                    useChat
                      .getState()
                      .upsertConversation(
                        await api.conversations.leave(conversationId),
                      );
                    await refresh();
                  },
                })
              }
            >
              <Icon name="logout" />
              Leave group
            </button>
          )}
          <button
            type="button"
            className="detail-action destructive"
            disabled={busy}
            onClick={() =>
              setConfirmation({
                title: "Delete conversation?",
                text: "This clears the conversation from your account. Other people keep their messages. This action can’t be undone.",
                label: "Delete conversation",
                action: async () => {
                  await api.conversations.remove(conversationId);
                  useChat.getState().removeConversation(conversationId);
                  onRemoved();
                },
              })
            }
          >
            <Icon name="trash" />
            Delete conversation
          </button>
        </section>
      </div>
      {addMembers && (
        <NewChat
          addToGroup={conversationId}
          excludedIds={detail?.members.map((member) => member.user.id) || []}
          onClose={() => setAddMembers(false)}
          onCreated={() => setAddMembers(false)}
        />
      )}
      {editing && (
        <Modal
          title="Edit group"
          onClose={() => setEditing(false)}
          dismissible={!busy}
        >
          <form className="ui-modal-body" onSubmit={saveGroup}>
            <label className="ui-field">
              Group name
              <input
                value={name}
                required
                maxLength={64}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="ui-field">
              Description
              <textarea
                value={description}
                maxLength={480}
                rows={3}
                disabled={busy}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <ErrorText>{error}</ErrorText>
            <div className="form-actions">
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? <Spinner /> : null}Save changes
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {confirmation && (
        <Modal
          title={confirmation.title}
          dismissible={!busy}
          onClose={() => {
            if (!busy) setConfirmation(null);
          }}
        >
          <div className="ui-modal-body">
            <p>{confirmation.text}</p>
            <ErrorText>{error}</ErrorText>
            <div className="form-actions">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirmation(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await confirmation.action();
                    setConfirmation(null);
                  })
                }
              >
                {busy ? <Spinner /> : null}
                {confirmation.label}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </aside>
  );
}
