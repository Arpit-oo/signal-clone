"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useSession } from "@/stores/session";
import {
  AVATAR_COLORS,
  Avatar,
  Button,
  ErrorText,
  Icon,
  Spinner,
  errorMessage,
} from "./ui";
import type { AvatarColor } from "@/lib/types";

export default function ProfileEditor({
  onSaved,
  onboarding = false,
}: {
  onSaved?: () => void;
  onboarding?: boolean;
}) {
  const me = useSession((s) => s.me)!;
  const [name, setName] = useState(me.display_name);
  const [username, setUsername] = useState(me.username ?? "");
  const [about, setAbout] = useState(me.about);
  const [color, setColor] = useState(me.avatar_color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaved(false);
    setBusy(true);
    try {
      const updated = await api.me.update({
        display_name: name.trim(),
        username: username.trim().replace(/^@/, "").toLowerCase() || null,
        about,
        avatar_color: color,
      });
      useSession.getState().setMe(updated);
      setName(updated.display_name);
      setUsername(updated.username ?? "");
      setAbout(updated.about);
      setColor(updated.avatar_color);
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function avatar(file?: File) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("Choose an image smaller than 10 MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      useSession.getState().setMe(await api.me.uploadAvatar(file));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function removeAvatar() {
    setBusy(true);
    setError("");
    try {
      useSession.getState().setMe(await api.me.deleteAvatar());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="profile-editor" onSubmit={save}>
      <div className="profile-avatar-edit">
        <Avatar
          name={name || "You"}
          color={color}
          url={me.avatar_url}
          size={88}
        />
        <div>
          <label className="ui-button ui-button-secondary upload-button">
            <Icon name="image" size={17} />
            Choose photo
            <input
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={(e) => {
                void avatar(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {me.avatar_url && (
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={removeAvatar}
            >
              Remove photo
            </button>
          )}
        </div>
      </div>
      <label className="ui-field">
        Your name
        <input
          required
          value={name}
          maxLength={64}
          placeholder="First and last name"
          autoComplete="name"
          disabled={busy}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
        />
        <small>The name people see in conversations.</small>
      </label>
      <label className="ui-field">
        Username <span className="field-optional">optional</span>
        <input
          value={username}
          maxLength={32}
          placeholder="e.g. alex_rivera"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          onChange={(e) => {
            setUsername(e.target.value);
            setSaved(false);
          }}
        />
        <small>
          3–32 characters; start with a letter. Share your username to help
          people find you.
        </small>
      </label>
      <label className="ui-field">
        About
        <textarea
          value={about}
          maxLength={140}
          rows={2}
          placeholder="A little about you"
          disabled={busy}
          onChange={(e) => {
            setAbout(e.target.value);
            setSaved(false);
          }}
        />
        <small className="field-counter">{about.length}/140</small>
      </label>
      <div className="ui-field">
        Avatar color
        <div className="color-swatches">
          {Object.entries(AVATAR_COLORS).map(([key, value], i) => (
            <button
              type="button"
              key={key}
              aria-label={`Avatar color ${i + 1}`}
              aria-pressed={color === key}
              className={`color-swatch ${color === key ? "selected" : ""}`}
              style={{ background: value }}
              disabled={busy}
              onClick={() => {
                setColor(key as AvatarColor);
                setSaved(false);
              }}
            >
              {color === key && <Icon name="check" size={18} />}
            </button>
          ))}
        </div>
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="form-actions">
        {saved && (
          <span className="saved-label" role="status">
            <Icon name="check" size={16} />
            Profile saved
          </span>
        )}
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? <Spinner /> : null}
          {onboarding ? "Start messaging" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
