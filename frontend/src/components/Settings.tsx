"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import {
  CHAT_COLORS,
  TEXT_SCALES,
  chatColorCss,
  usePrefs,
  type ThemePref,
  type NotificationContent,
} from "@/stores/prefs";
import { useSession } from "@/stores/session";
import { useChat } from "@/stores/chat";
import ProfileEditor from "./ProfileEditor";
import {
  Avatar,
  Button,
  ErrorText,
  Icon,
  Modal,
  Spinner,
  Toggle,
  errorMessage,
} from "./ui";

const tabs = [
  { id: "profile", label: "Profile", icon: "user" },
  { id: "appearance", label: "Appearance", icon: "moon" },
  { id: "privacy", label: "Privacy", icon: "shield" },
  { id: "notifications", label: "Notifications", icon: "bell" },
  { id: "chats", label: "Chats", icon: "chat" },
] as const;
type Tab = (typeof tabs)[number]["id"];

function BlockedPeople() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    api.blocks
      .list()
      .then((items) => {
        if (active) setUsers(items);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  async function unblock(user: User) {
    setBusy(user.id);
    setError("");
    try {
      await api.blocks.unblock(user.id);
      useChat.getState().rememberUsers([{ ...user, is_blocked: false }]);
      await useChat.getState().loadConversations();
      setUsers((items) => items.filter((u) => u.id !== user.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="blocked-people">
      <h3>Blocked people</h3>
      {loading ? (
        <Spinner />
      ) : users.length ? (
        users.map((user) => (
          <div className="person-row" key={user.id}>
            <Avatar
              name={user.display_name}
              color={user.avatar_color}
              url={user.avatar_url}
              size={36}
            />
            <span className="person-info">
              <strong>{user.display_name}</strong>
              <small>{user.phone}</small>
            </span>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => void unblock(user)}
            >
              {busy === user.id ? <Spinner /> : "Unblock"}
            </Button>
          </div>
        ))
      ) : (
        <p className="muted-text">You haven’t blocked anyone.</p>
      )}
      <ErrorText>{error}</ErrorText>
      {error && (
        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={() => {
            setError("");
            setLoading(true);
            setAttempt((value) => value + 1);
          }}
        >
          Retry blocked people
        </Button>
      )}
    </div>
  );
}

export default function Settings({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("profile");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signOut, setSignOut] = useState(false);
  const [permission, setPermission] = useState<
    NotificationPermission | "unavailable"
  >(() =>
    typeof Notification === "undefined"
      ? "unavailable"
      : Notification.permission,
  );
  const me = useSession((s) => s.me)!;
  const prefs = usePrefs();
  useEffect(() => {
    const refreshPermission = () =>
      setPermission(
        typeof Notification === "undefined"
          ? "unavailable"
          : Notification.permission,
      );
    window.addEventListener("focus", refreshPermission);
    return () => window.removeEventListener("focus", refreshPermission);
  }, []);
  async function privacy(patch: {
    read_receipts_enabled?: boolean;
    typing_indicators_enabled?: boolean;
  }) {
    setBusy(true);
    setError("");
    try {
      useSession.getState().setMe(await api.me.update(patch));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function notifications(enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      if (enabled && typeof Notification !== "undefined") {
        const result =
          Notification.permission === "default"
            ? await Notification.requestPermission()
            : Notification.permission;
        setPermission(result);
        prefs.set({ notificationsEnabled: result === "granted" });
      } else prefs.set({ notificationsEnabled: false });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Settings" onClose={onClose} className="settings-modal">
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <button type="button" className="settings-profile-card" onClick={() => setTab("profile")}>
            <Avatar name={me.display_name} color={me.avatar_color} url={me.avatar_url} size={56} />
            <span><strong>{me.display_name}</strong><small>{me.phone}</small></span>
          </button>
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? "selected" : ""}
              aria-current={tab === item.id ? "page" : undefined}
              onClick={() => {
                setTab(item.id);
                setError("");
              }}
            >
              <Icon name={item.icon} size={19} />
              {item.label}
            </button>
          ))}
          <div className="settings-account">
            <Avatar
              name={me.display_name}
              color={me.avatar_color}
              url={me.avatar_url}
              size={34}
            />
            <span>
              {me.display_name}
              <small>{me.phone}</small>
            </span>
            <button
              type="button"
              className="text-button destructive"
              onClick={() => setSignOut(true)}
            >
              <Icon name="logout" size={16} />
              Sign out
            </button>
          </div>
        </nav>
        <div className="settings-content scroll-thin">
          <h2 key={tab} className="animate-fade-in">{tabs.find((item) => item.id === tab)?.label}</h2>
          <div hidden={tab !== "profile"}>
            <ProfileEditor />
            <div className="mobile-account">
              <span>Signed in as {me.phone}</span>
              <button
                type="button"
                className="text-button destructive"
                onClick={() => setSignOut(true)}
              >
                <Icon name="logout" size={16} />
                Sign out
              </button>
            </div>
          </div>
          {tab === "appearance" && (
            <>
              <p className="muted-text">Make Signal feel like home.</p>
              <label className="ui-field">
                Theme
                <select
                  aria-label="Theme"
                  value={prefs.theme}
                  onChange={(e) =>
                    prefs.set({ theme: e.target.value as ThemePref })
                  }
                >
                  <option value="system">Use system setting</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <div className="ui-field">
                Chat color
                <div className="color-swatches chat-swatches">
                  {Object.keys(CHAT_COLORS).map((key) => (
                    <button
                      type="button"
                      key={key}
                      aria-label={`${key} chat color`}
                      title={key}
                      aria-pressed={prefs.chatColor === key}
                      className={`color-swatch ${prefs.chatColor === key ? "selected" : ""}`}
                      style={{ background: chatColorCss(key) }}
                      onClick={() => prefs.set({ chatColor: key })}
                    >
                      {prefs.chatColor === key && (
                        <Icon name="check" size={18} />
                      )}
                    </button>
                  ))}
                </div>
                <div className="chat-color-preview">
                  <span className="preview-incoming">Looks good to me.</span>
                  <span
                    className="preview-outgoing"
                    style={{ background: chatColorCss(prefs.chatColor) }}
                  >
                    A little more you.
                  </span>
                </div>
                <div className="form-actions">
                  <Button
                    variant="secondary"
                    disabled={prefs.chatColor === "ultramarine"}
                    onClick={() => prefs.set({ chatColor: "ultramarine" })}
                  >
                    Use Signal blue
                  </Button>
                </div>
                <p className="subtle-note">
                  Chat color changes your outgoing messages. Choose a background
                  from the chat menu.
                </p>
              </div>
              <label className="ui-field">
                Message text size
                <select
                  value={prefs.textScale}
                  onChange={(e) =>
                    prefs.set({ textScale: Number(e.target.value) })
                  }
                >
                  {TEXT_SCALES.map((scale, index) => (
                    <option value={scale} key={scale}>
                      {["Small", "Default", "Large", "Extra large"][index]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {tab === "privacy" && (
            <>
              <p className="muted-text">
                Choose what you share in conversations.
              </p>
              <Toggle
                label="Read receipts"
                description="Let people know when you’ve read their messages."
                checked={me.read_receipts_enabled}
                disabled={busy}
                onChange={(checked) =>
                  void privacy({ read_receipts_enabled: checked })
                }
              />
              <Toggle
                label="Typing indicators"
                description="Show when you’re typing and see when others are typing."
                checked={me.typing_indicators_enabled}
                disabled={busy}
                onChange={(checked) =>
                  void privacy({ typing_indicators_enabled: checked })
                }
              />
              <ErrorText>{error}</ErrorText>
              <BlockedPeople />
              <div className="local-notice">
                <Icon name="lock" size={22} />
                <span>
                  <strong>About this local project</strong>
                  <small>
                    Messages are stored on your local server. This project does
                    not implement Signal’s end-to-end encryption.
                  </small>
                </span>
              </div>
            </>
          )}
          {tab === "notifications" && (
            <>
              <p className="muted-text">Stay in the loop when you’re away.</p>
              <Toggle
                label="Desktop notifications"
                description="Show a notification for new messages when this window is in the background."
                checked={prefs.notificationsEnabled && permission === "granted"}
                disabled={
                  busy ||
                  permission === "unavailable" ||
                  permission === "denied"
                }
                onChange={(checked) => void notifications(checked)}
              />
              {permission === "denied" && (
                <p className="ui-error">
                  Notifications are blocked. Allow them in your browser’s site
                  settings.
                </p>
              )}
              {permission === "unavailable" && (
                <p className="muted-text">
                  This browser does not support desktop notifications.
                </p>
              )}
              {permission === "default" && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void notifications(true)}
                >
                  Enable browser notifications
                </Button>
              )}
              <label className="ui-field">
                Show in notifications
                <select
                  value={prefs.notificationContent}
                  onChange={(e) =>
                    prefs.set({
                      notificationContent: e.target
                        .value as NotificationContent,
                    })
                  }
                >
                  <option value="name_and_message">Name and message</option>
                  <option value="name">Name only</option>
                  <option value="none">No name or message</option>
                </select>
              </label>
              <ErrorText>{error}</ErrorText>
              <Toggle
                label="Notification sound"
                description="Play a subtle sound for incoming messages."
                checked={prefs.notificationSound}
                onChange={(checked) =>
                  prefs.set({ notificationSound: checked })
                }
              />
            </>
          )}
          {tab === "chats" && (
            <>
              <p className="muted-text">
                A few small things that make messaging yours.
              </p>
              <Toggle
                label="Send with Enter"
                description="Press Enter to send and Shift + Enter for a new line. When off, use the send button."
                checked={prefs.sendWithEnter}
                onChange={(checked) => prefs.set({ sendWithEnter: checked })}
              />
              <Toggle
                label="Spell check"
                description="Use your browser’s spell checker while composing messages."
                checked={prefs.spellCheck}
                onChange={(checked) => prefs.set({ spellCheck: checked })}
              />
              <div className="local-notice">
                <Icon name="info" size={22} />
                <span>
                  <strong>Stay connected</strong>
                  <small>
                    Make one-to-one voice and video calls from a chat. Allow
                    microphone and camera access when your browser asks.
                  </small>
                </span>
              </div>
            </>
          )}
        </div>
      </div>
      {signOut && (
        <Modal
          title="Sign out?"
          onClose={() => setSignOut(false)}
          role="alertdialog"
        >
          <div className="ui-modal-body">
            <p>
              Sign out of {me.display_name}? Your conversations stay on the
              local server.
            </p>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setSignOut(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => useSession.getState().signOut()}
              >
                Sign out
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
