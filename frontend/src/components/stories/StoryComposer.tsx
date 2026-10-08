/* eslint-disable @next/next/no-img-element -- Local previews use object URLs. */
"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Story, User } from "@/lib/types";
import { useSession } from "@/stores/session";
import {
  Avatar,
  Button,
  ErrorText,
  Icon,
  Modal,
  Spinner,
  errorMessage,
} from "@/components/ui";

const colors = [
  "#3B45FD",
  "#1C5368",
  "#7C407D",
  "#AF344C",
  "#B96323",
  "#293649",
];
const allowedMedia = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
];

export default function StoryComposer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (story: Story) => void;
}) {
  const me = useSession((state) => state.me)!;
  const [kind, setKind] = useState<"text" | "media">("text");
  const [body, setBody] = useState("");
  const [color, setColor] = useState(colors[0]);
  const [media, setMedia] = useState<{ file: File; url: string } | null>(null);
  const [mediaError, setMediaError] = useState("");
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<User[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactsError, setContactsError] = useState("");
  const [contactsAttempt, setContactsAttempt] = useState(0);
  const [search, setSearch] = useState<{
    query: string;
    users: User[];
    error: string;
  }>({ query: "", users: [], error: "" });
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [recipients, setRecipients] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    api.contacts
      .list()
      .then((users) => {
        if (active) setContacts(users);
      })
      .catch((cause) => {
        if (active) setContactsError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setContactsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [contactsAttempt]);
  useEffect(() => {
    const needle = query.trim();
    if (!needle) return;
    let active = true;
    const timer = setTimeout(() => {
      api.users
        .search(needle)
        .then((users) => {
          if (active) setSearch({ query: needle, users, error: "" });
        })
        .catch((cause) => {
          if (active)
            setSearch({ query: needle, users: [], error: errorMessage(cause) });
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, searchAttempt]);
  useEffect(
    () => () => {
      if (media) URL.revokeObjectURL(media.url);
    },
    [media],
  );

  const needle = query.trim();
  const peopleLoading = needle ? search.query !== needle : contactsLoading;
  const peopleError = needle
    ? search.query === needle
      ? search.error
      : ""
    : contactsError;
  const people = (needle ? search.users : contacts).filter(
    (user) => user.id !== me.id && !user.is_blocked,
  );
  function chooseMedia(file: File | undefined) {
    if (!file) return;
    setError("");
    setMediaError("");
    if (!allowedMedia.includes(file.type)) {
      setMediaError("Choose a JPEG, PNG, WebP, GIF, MP4 or WebM file.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setMediaError("Stories can contain a photo or video up to 25 MB.");
      return;
    }
    setMedia({ file, url: URL.createObjectURL(file) });
  }
  function select(user: User) {
    setRecipients((current) =>
      current.some((recipient) => recipient.id === user.id)
        ? current.filter((recipient) => recipient.id !== user.id)
        : [...current, user],
    );
    setError("");
  }
  async function share() {
    if (busy || !recipients.length || (kind === "text" ? !body.trim() : !media))
      return;
    setBusy(true);
    setError("");
    try {
      const story = await api.stories.create({
        body: body.trim(),
        color,
        recipient_ids: recipients.map((user) => user.id),
        ...(kind === "media" && media ? { file: media.file } : {}),
      });
      onCreated(story);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Create story"
      onClose={onClose}
      dismissible={!busy}
      className="story-compose-modal"
    >
      <form
        className="ui-modal-body story-compose-layout"
        onSubmit={(event) => {
          event.preventDefault();
          void share();
        }}
      >
        <section className="story-compose-content" aria-label="Story content">
          <div className="segmented">
            <button
              type="button"
              aria-pressed={kind === "text"}
              className={kind === "text" ? "selected" : ""}
              disabled={busy}
              onClick={() => setKind("text")}
            >
              Text
            </button>
            <button
              type="button"
              aria-pressed={kind === "media"}
              className={kind === "media" ? "selected" : ""}
              disabled={busy}
              onClick={() => setKind("media")}
            >
              Photo or video
            </button>
          </div>
          <div
            className={`story-compose-preview ${kind === "media" ? "is-media" : ""}`}
            style={{ backgroundColor: color }}
            aria-label="Story preview"
          >
            {kind === "text" ? (
              <p>{body.trim() || "Your story"}</p>
            ) : media ? (
              media.file.type.startsWith("video/") ? (
                <video
                  key={media.url}
                  src={media.url}
                  controls
                  playsInline
                  onError={() =>
                    setMediaError(
                      "This video can’t be previewed. Try an MP4 or WebM video supported by your browser.",
                    )
                  }
                />
              ) : (
                <img
                  src={media.url}
                  alt="Your selected story photo"
                  onError={() =>
                    setMediaError(
                      "This photo can’t be previewed. Choose another image.",
                    )
                  }
                />
              )
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => picker.current?.click()}
              >
                <Icon name="image" size={36} />
                <span>Choose a photo or video</span>
              </button>
            )}
            {kind === "media" && media && body.trim() && (
              <p className="story-preview-caption">{body.trim()}</p>
            )}
          </div>
          {kind === "media" && (
            <>
              <input
                ref={picker}
                className="story-file-input"
                type="file"
                aria-label="Story photo or video"
                accept={allowedMedia.join(",")}
                disabled={busy}
                onChange={(event) => {
                  chooseMedia(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => picker.current?.click()}
              >
                {media ? "Change photo or video" : "Choose photo or video"}
              </Button>
              <ErrorText>{mediaError}</ErrorText>
            </>
          )}
          <label className="ui-field">
            {kind === "text" ? "Story text" : "Caption"}
            <textarea
              aria-label={kind === "text" ? "Story text" : "Caption"}
              value={body}
              disabled={busy}
              maxLength={2000}
              placeholder={
                kind === "text"
                  ? "Share something with your people…"
                  : "Add a caption (optional)"
              }
              onChange={(event) => setBody(event.target.value)}
            />
            <small className="field-counter">{body.length}/2000</small>
          </label>
          {kind === "text" && (
            <div
              className="story-colors"
              role="group"
              aria-label="Story background"
            >
              {colors.map((value) => (
                <button
                  type="button"
                  key={value}
                  style={{ backgroundColor: value }}
                  aria-label={`Use ${value} background`}
                  aria-pressed={color === value}
                  disabled={busy}
                  onClick={() => setColor(value)}
                >
                  {color === value && <Icon name="check" size={17} />}
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="story-compose-audience" aria-label="Story audience">
          <h3>Share with</h3>
          <p>
            Only the people you select can see this story. It expires after 24
            hours.
          </p>
          {recipients.length > 0 && (
            <div className="story-recipient-chips">
              {recipients.map((user) => (
                <button
                  type="button"
                  key={user.id}
                  disabled={busy}
                  aria-label={`Remove ${user.display_name} from audience`}
                  onClick={() => select(user)}
                >
                  <Avatar
                    name={user.display_name}
                    color={user.avatar_color}
                    url={user.avatar_url}
                    size={22}
                  />
                  {user.display_name}
                  <Icon name="close" size={13} />
                </button>
              ))}
            </div>
          )}
          <label className="search-field">
            <Icon name="search" size={18} />
            <input
              aria-label="Find people"
              placeholder="Name, username or phone"
              maxLength={64}
              value={query}
              disabled={busy}
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="story-audience-list scroll-thin">
            {peopleLoading ? (
              <div className="centered-state">
                <Spinner label="Finding people" />
                <p>{needle ? "Searching people…" : "Loading contacts…"}</p>
              </div>
            ) : peopleError ? (
              <div className="centered-state">
                <ErrorText>{peopleError}</ErrorText>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    if (needle) {
                      setSearch({ query: "", users: [], error: "" });
                      setSearchAttempt((value) => value + 1);
                    } else {
                      setContactsLoading(true);
                      setContactsError("");
                      setContactsAttempt((value) => value + 1);
                    }
                  }}
                >
                  Retry people
                </Button>
              </div>
            ) : people.length ? (
              people.map((user) => (
                <button
                  type="button"
                  className="person-row"
                  key={user.id}
                  aria-pressed={recipients.some(
                    (recipient) => recipient.id === user.id,
                  )}
                  disabled={busy}
                  onClick={() => select(user)}
                >
                  <Avatar
                    name={user.nickname || user.display_name}
                    color={user.avatar_color}
                    url={user.avatar_url}
                    size={36}
                  />
                  <span className="person-info">
                    <strong>{user.nickname || user.display_name}</strong>
                    <small>
                      {user.username ? `@${user.username}` : user.phone}
                    </small>
                  </span>
                  <span
                    className={`select-check ${recipients.some((recipient) => recipient.id === user.id) ? "selected" : ""}`}
                  >
                    {recipients.some(
                      (recipient) => recipient.id === user.id,
                    ) && <Icon name="check" size={14} />}
                  </span>
                </button>
              ))
            ) : (
              <div className="centered-state">
                <p>
                  {needle
                    ? "No registered people found"
                    : "Find people to share with"}
                </p>
                <small>Search by a registered phone number or username.</small>
              </div>
            )}
          </div>
          <p className="story-audience-count" role="status">
            {recipients.length
              ? `${recipients.length} ${recipients.length === 1 ? "person" : "people"} selected`
              : "Select at least one person."}
          </p>
        </section>
        <footer className="story-compose-footer">
          <ErrorText>{error}</ErrorText>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              busy ||
              !recipients.length ||
              (kind === "text" ? !body.trim() : !media || !!mediaError)
            }
          >
            {busy ? (
              <Spinner label="Sharing story" />
            ) : (
              <Icon name="check" size={17} />
            )}
            {busy ? "Sharing story…" : "Share story"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
