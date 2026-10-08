"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { ConversationDetail, User } from "@/lib/types";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import {
  Avatar,
  Button,
  ErrorText,
  Icon,
  Modal,
  Spinner,
  errorMessage,
} from "./ui";

export default function NewChat({
  onClose,
  onCreated,
  addToGroup,
  excludedIds = [],
}: {
  onClose: () => void;
  onCreated: (id: number) => void;
  addToGroup?: number;
  excludedIds?: number[];
}) {
  const [mode, setMode] = useState<"direct" | "group">(
    addToGroup ? "group" : "direct",
  );
  const [query, setQuery] = useState("");
  const meId = useSession((state) => state.me?.id);
  const [lookupMode, setLookupMode] = useState<"search" | "phone" | "username">(
    "search",
  );
  const [lookupResult, setLookupResult] = useState<User | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [lookupPending, setLookupPending] = useState(false);
  const lookupRequest = useRef(0);
  const [contacts, setContacts] = useState<User[]>([]);
  const [search, setSearch] = useState<{
    query: string;
    items: User[];
    error: string;
  }>({ query: "", items: [], error: "" });
  const [contactsError, setContactsError] = useState("");
  const [contactsAttempt, setContactsAttempt] = useState(0);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [selected, setSelected] = useState<User[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api.contacts
      .list()
      .then((users) => {
        if (active) {
          setContacts(users);
          useChat.getState().rememberUsers(users);
        }
      })
      .catch((e) => {
        if (active) setContactsError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [contactsAttempt]);
  useEffect(() => {
    const needle = query.trim();
    if (!needle || lookupMode !== "search") return;
    let active = true;
    const timer = setTimeout(() => {
      api.users
        .search(needle)
        .then((users) => {
          if (active) {
            setSearch({ query: needle, items: users, error: "" });
            useChat.getState().rememberUsers(users);
          }
        })
        .catch((e) => {
          if (active)
            setSearch({ query: needle, items: [], error: errorMessage(e) });
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, searchAttempt, lookupMode]);
  const needle = query.trim();
  const peopleLoading =
    lookupMode !== "search"
      ? lookupPending
      : needle
        ? search.query !== needle
        : loading;
  const peopleError =
    lookupMode !== "search"
      ? lookupError
      : needle
        ? search.query === needle
          ? search.error
          : ""
        : contactsError;
  const users = (
    lookupMode !== "search"
      ? lookupResult
        ? [lookupResult]
        : []
      : needle
        ? search.items
        : contacts
  ).filter(
    (user) =>
      user.id !== meId && !excludedIds.includes(user.id) && !user.is_blocked,
  );
  function changeLookup(next: "search" | "phone" | "username") {
    lookupRequest.current += 1;
    setLookupMode(next);
    setQuery("");
    setLookupResult(null);
    setLookupError("");
    setLookupPending(false);
    setError("");
  }
  async function findExact() {
    if (lookupMode === "search" || lookupPending) return;
    const address =
      lookupMode === "phone"
        ? needle.replace(/[\s().-]/g, "")
        : needle.replace(/^@/, "").toLowerCase();
    if (
      lookupMode === "phone"
        ? !/^\+?[1-9]\d{6,14}$/.test(address)
        : !/^[a-z][a-z0-9_]{2,31}$/.test(address)
    ) {
      setLookupError(
        lookupMode === "phone"
          ? "Enter a full phone number including the country code, for example +14155550123."
          : "Enter a username with 3–32 letters, numbers or underscores, starting with a letter.",
      );
      return;
    }
    const request = ++lookupRequest.current;
    setLookupPending(true);
    setLookupError("");
    setLookupResult(null);
    try {
      const user = await api.users.lookup(
        lookupMode === "phone"
          ? { phone: address.startsWith("+") ? address : `+${address}` }
          : { username: address },
      );
      if (request !== lookupRequest.current) return;
      if (user.id === meId)
        setLookupError(
          "This is your account. Use Note to Self in your chat list.",
        );
      else if (excludedIds.includes(user.id))
        setLookupError("This person already belongs to the group.");
      else if (user.is_blocked)
        setLookupError(
          "Unblock this person in Settings before starting a conversation.",
        );
      else {
        setLookupResult(user);
        useChat.getState().rememberUsers([user]);
      }
    } catch (cause) {
      if (request === lookupRequest.current)
        setLookupError(
          cause instanceof ApiError && cause.status === 404
            ? `No registered account has that ${lookupMode === "phone" ? "phone number" : "username"}. Ask them to create an account, then try again.`
            : errorMessage(cause),
        );
    } finally {
      if (request === lookupRequest.current) setLookupPending(false);
    }
  }
  async function direct(user: User) {
    setBusy(true);
    setError("");
    try {
      const conversation = await api.conversations.createDirect(user.id);
      useChat.getState().upsertConversation(conversation);
      onCreated(conversation.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function select(user: User) {
    setSelected((prev) =>
      prev.some((u) => u.id === user.id)
        ? prev.filter((u) => u.id !== user.id)
        : [...prev, user],
    );
  }
  async function create() {
    setBusy(true);
    setError("");
    try {
      const conversation = addToGroup
        ? await api.conversations.addMembers(
            addToGroup,
            selected.map((user) => user.id),
          )
        : await api.conversations.createGroup({
            name: name.trim(),
            description: description.trim(),
            member_ids: selected.map((user) => user.id),
            avatar_color: "A130",
          });
      useChat.getState().upsertConversation(conversation);
      if (addToGroup) {
        const detail = conversation as ConversationDetail;
        useChat.setState((state) => ({
          details: { ...state.details, [detail.id]: detail },
        }));
        useChat
          .getState()
          .rememberUsers(detail.members.map((member) => member.user));
      } else await useChat.getState().loadDetail(conversation.id);
      onCreated(conversation.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={addToGroup ? "Add members" : "New conversation"}
      onClose={onClose}
      dismissible={!busy}
      className="new-chat-modal"
    >
      <div className="ui-modal-body">
        {!addToGroup && (
          <div className="segmented">
            <button
              type="button"
              disabled={busy}
              className={mode === "direct" ? "selected" : ""}
              onClick={() => {
                setMode("direct");
                setError("");
              }}
            >
              <Icon name="user" size={17} />
              Direct message
            </button>
            <button
              type="button"
              disabled={busy}
              className={mode === "group" ? "selected" : ""}
              onClick={() => {
                setMode("group");
                setError("");
              }}
            >
              <Icon name="users" size={17} />
              New group
            </button>
          </div>
        )}
        {mode === "group" && !addToGroup && (
          <>
            <label className="ui-field">
              Group name
              <input
                placeholder="Give your group a name"
                value={name}
                maxLength={64}
                required
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="ui-field">
              Description <span className="field-optional">optional</span>
              <input
                placeholder="What brings you together?"
                maxLength={480}
                value={description}
                disabled={busy}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          </>
        )}
        {mode === "group" && selected.length > 0 && (
          <div className="member-chips">
            {selected.map((user) => (
              <button
                type="button"
                key={user.id}
                onClick={() => select(user)}
                disabled={busy}
              >
                <Avatar
                  name={user.nickname || user.display_name}
                  color={user.avatar_color}
                  url={user.avatar_url}
                  size={22}
                />
                {user.nickname || user.display_name}
                <Icon name="close" size={14} />
              </button>
            ))}
          </div>
        )}
        <div className="new-chat-lookup-tabs" aria-label="Find people by">
          <button
            type="button"
            disabled={busy}
            aria-pressed={lookupMode === "search"}
            onClick={() => changeLookup("search")}
          >
            Search
          </button>
          <button
            type="button"
            disabled={busy}
            aria-pressed={lookupMode === "phone"}
            onClick={() => changeLookup("phone")}
          >
            Phone number
          </button>
          <button
            type="button"
            disabled={busy}
            aria-pressed={lookupMode === "username"}
            onClick={() => changeLookup("username")}
          >
            Username
          </button>
        </div>
        <form
          className="new-chat-lookup-form"
          onSubmit={(event) => {
            event.preventDefault();
            void findExact();
          }}
        >
          <label className="search-field">
            <Icon name="search" size={19} />
            <input
              placeholder={
                lookupMode === "phone"
                  ? "Phone number with country code"
                  : lookupMode === "username"
                    ? "Exact username, e.g. @alex"
                    : "Name, username or phone number"
              }
              aria-label="Find a person"
              maxLength={lookupMode === "username" ? 33 : 64}
              inputMode={lookupMode === "phone" ? "tel" : "text"}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                lookupRequest.current += 1;
                setLookupResult(null);
                setLookupError("");
                setLookupPending(false);
                setError("");
              }}
              disabled={busy}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  lookupRequest.current += 1;
                  setLookupResult(null);
                  setLookupError("");
                  setLookupPending(false);
                }}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </label>
          {lookupMode !== "search" && (
            <Button type="submit" disabled={busy || lookupPending || !needle}>
              {lookupPending ? (
                <Spinner label="Finding person" />
              ) : (
                <Icon name="search" size={17} />
              )}
              Find person
            </Button>
          )}
        </form>
        <p className="section-label">
          {lookupMode !== "search"
            ? "ACCOUNT LOOKUP"
            : query.trim()
              ? "SEARCH RESULTS"
              : "YOUR CONTACTS"}
          {mode === "group" && <span>{selected.length} selected</span>}
        </p>
        <div className="new-chat-users scroll-thin">
          {peopleLoading ? (
            <div className="centered-state">
              <Spinner
                label={needle ? "Searching people" : "Loading contacts"}
              />
              <p>{needle ? "Searching people…" : "Loading contacts…"}</p>
            </div>
          ) : peopleError ? (
            <div className="centered-state">
              <ErrorText>{peopleError}</ErrorText>
              <Button
                variant="secondary"
                onClick={() => {
                  if (lookupMode !== "search") {
                    void findExact();
                  } else if (needle) {
                    setSearch({ query: "", items: [], error: "" });
                    setSearchAttempt((value) => value + 1);
                  } else {
                    setLoading(true);
                    setContactsError("");
                    setContactsAttempt((value) => value + 1);
                  }
                }}
              >
                Retry{" "}
                {lookupMode !== "search"
                  ? "lookup"
                  : needle
                    ? "search"
                    : "contacts"}
              </Button>
            </div>
          ) : users.length ? (
            users.map((user) => (
              <button
                type="button"
                className="person-row"
                key={user.id}
                disabled={busy}
                onClick={() =>
                  mode === "direct" ? void direct(user) : select(user)
                }
              >
                <Avatar
                  name={user.nickname || user.display_name}
                  color={user.avatar_color}
                  url={user.avatar_url}
                />
                <span className="person-info">
                  <strong>{user.nickname || user.display_name}</strong>
                  <small>
                    {user.username
                      ? `@${user.username} · ${user.phone}`
                      : user.phone}
                  </small>
                </span>
                {mode === "group" ? (
                  <span
                    className={`select-check ${selected.some((u) => u.id === user.id) ? "selected" : ""}`}
                  >
                    {selected.some((u) => u.id === user.id) && (
                      <Icon name="check" size={15} />
                    )}
                  </span>
                ) : (
                  <Icon name="chevron-right" size={17} />
                )}
              </button>
            ))
          ) : (
            <div className="centered-state">
              <Icon name="users" size={30} />
              <p>
                {lookupMode !== "search"
                  ? "Find an account"
                  : query.trim()
                    ? "No people found"
                    : "Find someone to start a conversation"}
              </p>
              <small>
                {lookupMode === "phone"
                  ? "Enter the number they used to register, including the country code."
                  : lookupMode === "username"
                    ? "Enter their exact username. The @ symbol is optional."
                    : query.trim()
                      ? "Try another name, username or phone number."
                      : "Search by their name, username or phone number."}
              </small>
            </div>
          )}
        </div>
        {busy && mode === "direct" && (
          <p className="details-busy" role="status">
            <Spinner label="Opening conversation" />
            Opening conversation…
          </p>
        )}
        <ErrorText>{error}</ErrorText>
        <p className="subtle-note">
          {addToGroup
            ? "New members can see messages sent after they join."
            : "Only registered accounts appear here. Ask someone to create an account, then search for their phone number or username."}
        </p>
        {mode === "group" && (
          <div className="form-actions">
            <Button
              disabled={
                busy || !selected.length || (!addToGroup && !name.trim())
              }
              onClick={create}
            >
              {busy ? <Spinner /> : <Icon name="users" size={18} />}{" "}
              {addToGroup
                ? `Add ${selected.length || ""} members`
                : "Create group"}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
