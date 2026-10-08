"use client";

/* eslint-disable @next/next/no-img-element -- Local attachment previews use browser blob URLs. */

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from "react";
import type { Theme } from "emoji-picker-react";
import { Avatar, Icon } from "@/components/ui";
import type { ChatMessage, Conversation, User } from "@/lib/types";
import { displayName, notifyTyping, stopTyping, useChat } from "@/stores/chat";
import { usePrefs } from "@/stores/prefs";
import { useSession } from "@/stores/session";
import { errorMessage, formatBytes, formatDuration } from "./helpers";

const EmojiPicker = lazy(() => import("emoji-picker-react"));
interface VoiceDraft {
  blob: Blob;
  durationMs: number;
}
interface ComposerDraft {
  body: string;
  files: File[];
  voice: VoiceDraft | null;
  mentions: { id: number; text: string }[];
}
const drafts = new Map<number, ComposerDraft>();

function FilePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const image = file.type.startsWith("image/");
  useEffect(() => {
    const element = imageRef.current;
    if (!element || !image) return;
    const preview = URL.createObjectURL(file);
    element.src = preview;
    return () => {
      element.removeAttribute("src");
      URL.revokeObjectURL(preview);
    };
  }, [file, image]);
  return (
    <div className="chat-pending-file">
      {image ? (
        <img ref={imageRef} alt={file.name} />
      ) : (
        <Icon name="file" size={26} />
      )}
      <span>
        <strong>{file.name}</strong>
        <small>{formatBytes(file.size)}</small>
      </span>
      <button
        className="chat-icon-button"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

function VoicePreview({ voice }: { voice: VoiceDraft }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    const url = URL.createObjectURL(voice.blob);
    element.src = url;
    return () => {
      element.pause();
      element.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [voice.blob]);
  return <audio controls ref={audioRef} aria-label="Preview voice message" />;
}

export function Composer({
  conversation,
  reply,
  edit,
  onCancelContext,
  onSent,
}: {
  conversation: Conversation;
  reply: ChatMessage | null;
  edit: ChatMessage | null;
  onCancelContext: () => void;
  onSent: () => void;
}) {
  const [initialDraft] = useState(() => drafts.get(conversation.id));
  const [body, setBody] = useState(
    () => edit?.body ?? initialDraft?.body ?? "",
  );
  const [files, setFiles] = useState<File[]>(() =>
    edit ? [] : (initialDraft?.files ?? []),
  );
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const [requestingMic, setRequestingMic] = useState(false);
  const [recordedMs, setRecordedMs] = useState(0);
  const [voice, setVoice] = useState<VoiceDraft | null>(() =>
    edit ? null : (initialDraft?.voice ?? null),
  );
  const [mention, setMention] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const [mentionedUsers, setMentionedUsers] = useState<
    { id: number; text: string }[]
  >(() => (edit ? [] : (initialDraft?.mentions ?? [])));
  const [mentionIndex, setMentionIndex] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const emojiPanel = useRef<HTMLDivElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recordingStarted = useRef(0);
  const cancelled = useRef(false);
  const alive = useRef(true);
  const send = useChat((state) => state.send);
  const users = useChat((state) => state.users);
  const detail = useChat((state) => state.details[conversation.id]);
  const me = useSession((state) => state.me);
  const sendWithEnter = usePrefs((state) => state.sendWithEnter);
  const spellCheck = usePrefs((state) => state.spellCheck);
  const theme = usePrefs((state) => state.theme);
  const blocked = conversation.peer?.is_blocked;
  const disabled = !conversation.is_member || blocked;
  const mentionOptions = mention
    ? (detail?.members ?? [])
        .map((member) => member.user)
        .filter(
          (user) =>
            user.id !== me?.id &&
            displayName(user)
              .toLowerCase()
              .includes(mention.query.toLowerCase()),
        )
        .slice(0, 6)
    : [];

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopTyping();
      if (recorder.current && recorder.current.state !== "inactive") {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  useEffect(() => {
    if (edit) return;
    if (body || files.length || voice)
      drafts.set(conversation.id, {
        body,
        files,
        voice,
        mentions: mentionedUsers,
      });
    else drafts.delete(conversation.id);
  }, [conversation.id, body, files, voice, mentionedUsers, edit]);
  useEffect(() => {
    if (!disabled) return;
    stopTyping();
    cancelled.current = true;
    if (recorder.current && recorder.current.state !== "inactive")
      recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
  }, [disabled]);
  useEffect(() => {
    const input = textarea.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
  }, [body]);
  useEffect(() => {
    if (edit || reply) textarea.current?.focus();
  }, [edit, reply]);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const duration = Date.now() - recordingStarted.current;
      setRecordedMs(duration);
      if (duration >= 300000 && recorder.current?.state === "recording")
        recorder.current.stop();
    }, 250);
    return () => clearInterval(timer);
  }, [recording]);
  useEffect(() => {
    if (!emojiOpen) return;
    function dismiss(event: MouseEvent) {
      if (!emojiPanel.current?.contains(event.target as Node))
        setEmojiOpen(false);
    }
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setEmojiOpen(false);
    }
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [emojiOpen]);

  function updateBody(value: string) {
    setBody(value);
    if (me?.typing_indicators_enabled && value.trim())
      notifyTyping(conversation.id);
    else stopTyping();
  }
  function detectMention(value: string, cursor: number) {
    if (edit || conversation.type !== "group") return;
    const match = value.slice(0, cursor).match(/(?:^|\s)@([^\s@]*)$/);
    setMention(
      match
        ? { start: cursor - match[1].length - 1, end: cursor, query: match[1] }
        : null,
    );
    setMentionIndex(0);
  }
  function insertMention(user: User) {
    if (!mention) return;
    const text = `@${displayName(user)}`;
    const next = `${body.slice(0, mention.start)}${text} ${body.slice(mention.end)}`;
    if (next.length > 8000) return;
    const cursor = mention.start + text.length + 1;
    updateBody(next);
    setMentionedUsers((current) => [
      ...current.filter((item) => item.id !== user.id),
      { id: user.id, text },
    ]);
    setMention(null);
    textarea.current?.focus();
    requestAnimationFrame(() =>
      textarea.current?.setSelectionRange(cursor, cursor),
    );
  }
  function addFiles(incoming: File[]) {
    if (disabled || edit || sending || recording) return;
    if (files.length + incoming.length + (voice ? 1 : 0) > 32) {
      setError(
        "You can attach up to 32 files, including voice messages, to one message.",
      );
      return;
    }
    setFiles((current) => [...current, ...incoming]);
    setError(null);
    textarea.current?.focus();
  }
  function pickFiles(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }
  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = Array.from(event.clipboardData.files);
    if (pasted.length && !edit) {
      event.preventDefault();
      addFiles(pasted);
    }
  }
  async function submit() {
    if (
      sending ||
      disabled ||
      recording ||
      requestingMic ||
      (!body.trim() && !files.length && !voice)
    )
      return;
    if (edit && !body.trim()) {
      setError("An edited message needs some text.");
      return;
    }
    const text = body.trim();
    setError(null);
    setSending(true);
    stopTyping();
    try {
      if (edit) {
        const { api } = await import("@/lib/api");
        const updated = await api.messages.edit(edit.id, text);
        useChat
          .getState()
          .handleEvent({ type: "message.updated", data: updated });
      } else {
        await send(conversation.id, {
          body: text,
          files,
          replyTo: reply,
          voice: voice
            ? { blob: voice.blob, durationMs: voice.durationMs }
            : null,
          mentions: mentionedUsers
            .filter((user) => text.includes(user.text))
            .map((user) => user.id),
        });
        const currentDraft = drafts.get(conversation.id);
        if (
          currentDraft?.body === body &&
          currentDraft.files === files &&
          currentDraft.voice === voice
        )
          drafts.delete(conversation.id);
      }
      if (!alive.current) return;
      setBody("");
      setFiles([]);
      setVoice(null);
      setEmojiOpen(false);
      setMention(null);
      setMentionedUsers([]);
      onSent();
      textarea.current?.focus();
    } catch (cause) {
      if (alive.current) setError(errorMessage(cause));
    } finally {
      if (alive.current) setSending(false);
    }
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (mention && mentionOptions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex(
          (index) =>
            (index +
              (event.key === "ArrowDown" ? 1 : -1) +
              mentionOptions.length) %
            mentionOptions.length,
        );
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        insertMention(mentionOptions[mentionIndex] ?? mentionOptions[0]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
    }
    if (event.key === "Escape" && (reply || edit)) {
      event.preventDefault();
      onCancelContext();
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      (sendWithEnter || event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault();
      void submit();
    }
  }
  async function startRecording() {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError(
        "Voice recording requires a supported browser and a secure connection (HTTPS or localhost).",
      );
      return;
    }
    setRequestingMic(true);
    setError(null);
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const currentConversation =
        useChat.getState().conversations[conversation.id];
      if (
        !alive.current ||
        !currentConversation?.is_member ||
        currentConversation.peer?.is_blocked ||
        useSession.getState().me?.id !== me?.id
      ) {
        microphone.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = microphone;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const activeRecorder = new MediaRecorder(
        microphone,
        mimeType ? { mimeType } : undefined,
      );
      const chunks: Blob[] = [];
      cancelled.current = false;
      activeRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      activeRecorder.onstop = () => {
        microphone.getTracks().forEach((track) => track.stop());
        if (recorder.current === activeRecorder) recorder.current = null;
        if (!alive.current) return;
        setRecording(false);
        if (cancelled.current) return;
        const blob = new Blob(chunks, { type: activeRecorder.mimeType });
        if (!blob.size) {
          setError("No audio was recorded. Please try again.");
          return;
        }
        setVoice({
          blob,
          durationMs: Math.min(300000, Date.now() - recordingStarted.current),
        });
      };
      activeRecorder.onerror = () => {
        cancelled.current = true;
        if (activeRecorder.state !== "inactive") activeRecorder.stop();
        microphone.getTracks().forEach((track) => track.stop());
        if (alive.current) {
          setError("Recording failed. Please try again.");
          setRecording(false);
        }
      };
      recorder.current = activeRecorder;
      recordingStarted.current = Date.now();
      activeRecorder.start();
      setRecordedMs(0);
      setRecording(true);
      setEmojiOpen(false);
      setMention(null);
      stopTyping();
      microphone.getAudioTracks().forEach((track) =>
        track.addEventListener(
          "ended",
          () => {
            if (activeRecorder.state !== "inactive") activeRecorder.stop();
          },
          { once: true },
        ),
      );
    } catch (cause) {
      stream.current?.getTracks().forEach((track) => track.stop());
      recorder.current = null;
      if (alive.current)
        setError(
          cause instanceof DOMException && cause.name === "NotAllowedError"
            ? "Microphone permission was denied. Allow microphone access in your browser to record a voice message."
            : errorMessage(cause),
        );
    } finally {
      if (alive.current) setRequestingMic(false);
    }
  }
  function endRecording(cancel = false) {
    cancelled.current = cancel;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }
  if (disabled)
    return (
      <div className="chat-disabled-composer">
        <Icon name={blocked ? "shield" : "info"} size={18} />
        <span>
          {blocked
            ? "You blocked this person. Unblock them in conversation details to send messages."
            : "You are no longer a member of this group."}
        </span>
      </div>
    );
  const canSend = !!body.trim() || !!files.length || !!voice;
  return (
    <div
      className={`chat-composer-area ${dragging ? "chat-dragging" : ""}`}
      onDragOver={(event) => {
        if (
          edit ||
          recording ||
          sending ||
          !event.dataTransfer.types.includes("Files")
        )
          return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {dragging && <div className="chat-drop-label">Drop files to attach</div>}
      {error && (
        <div className="chat-inline-error" role="alert">
          <Icon name="alert" size={16} />
          <span>{error}</span>
          <button
            className="chat-icon-button"
            aria-label="Dismiss error"
            onClick={() => setError(null)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {(reply || edit) && (
        <div className="chat-compose-context">
          <Icon name={edit ? "edit" : "reply"} size={18} />
          <span>
            <strong>
              {edit
                ? "Edit message"
                : `Reply to ${reply?.sender_id === me?.id ? "yourself" : displayName(reply?.sender_id ? users[reply.sender_id] : null)}`}
            </strong>
            <small>{(edit ?? reply)?.body || "Attachment"}</small>
          </span>
          <button
            className="chat-icon-button"
            aria-label={edit ? "Cancel editing" : "Cancel reply"}
            onClick={onCancelContext}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      {files.length > 0 && (
        <div className="chat-pending-files">
          {files.map((file, index) => (
            <FilePreview
              key={`${file.name}-${file.lastModified}-${index}`}
              file={file}
              onRemove={() =>
                setFiles((current) =>
                  current.filter((_, fileIndex) => fileIndex !== index),
                )
              }
            />
          ))}
        </div>
      )}
      {voice && (
        <div className="chat-voice-preview">
          <Icon name="mic" size={20} />
          <VoicePreview voice={voice} />
          <span>{formatDuration(voice.durationMs)}</span>
          <button
            className="chat-icon-button"
            aria-label="Discard voice message"
            onClick={() => setVoice(null)}
          >
            <Icon name="trash" size={18} />
          </button>
        </div>
      )}
      {mention && mentionOptions.length > 0 && (
        <div
          className="chat-mention-options"
          role="listbox"
          aria-label="Mention a group member"
        >
          {mentionOptions.map((user, index) => (
            <button
              key={user.id}
              role="option"
              aria-selected={index === mentionIndex}
              className={index === mentionIndex ? "chat-mention-selected" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertMention(user)}
            >
              <Avatar
                name={displayName(user)}
                color={user.avatar_color}
                url={user.avatar_url}
                size={28}
              />
              <span>{displayName(user)}</span>
              <small>@{user.username || user.phone}</small>
            </button>
          ))}
        </div>
      )}
      <div className="chat-composer">
        <div className="chat-emoji-anchor" ref={emojiPanel}>
          <button
            className="chat-icon-button"
            aria-label="Choose an emoji"
            aria-expanded={emojiOpen}
            disabled={recording || requestingMic || sending}
            onClick={() => {
              setMention(null);
              setEmojiOpen(!emojiOpen);
            }}
          >
            <Icon name="smile" size={23} />
          </button>
          {emojiOpen && (
            <div className="chat-emoji-panel">
              <Suspense
                fallback={
                  <div className="chat-loading">Loading emoji picker…</div>
                }
              >
                <EmojiPicker
                  width={320}
                  height={370}
                  theme={(theme === "system" ? "auto" : theme) as Theme}
                  skinTonesDisabled
                  previewConfig={{ showPreview: false }}
                  lazyLoadEmojis
                  onEmojiClick={(data) => {
                    const input = textarea.current;
                    const start = input?.selectionStart ?? body.length;
                    const end = input?.selectionEnd ?? start;
                    const next = `${body.slice(0, start)}${data.emoji}${body.slice(end)}`;
                    if (next.length > 8000) return;
                    updateBody(next);
                    input?.focus();
                    requestAnimationFrame(() =>
                      input?.setSelectionRange(
                        start + data.emoji.length,
                        start + data.emoji.length,
                      ),
                    );
                  }}
                />
              </Suspense>
            </div>
          )}
        </div>
        <div className="chat-composer-input">
          {recording ? (
            <div className="chat-recording" role="status">
              <span className="chat-recording-dot" />
              <strong>Recording</strong>
              <span>{formatDuration(recordedMs)}</span>
              <button
                className="chat-text-button"
                onClick={() => endRecording(true)}
              >
                Cancel
              </button>
              <button
                className="chat-icon-button"
                aria-label="Finish recording"
                onClick={() => endRecording()}
              >
                <Icon name="stop" size={23} />
              </button>
            </div>
          ) : (
            <textarea
              ref={textarea}
              value={body}
              onChange={(event) => {
                updateBody(event.target.value);
                detectMention(event.target.value, event.target.selectionStart);
              }}
              onClick={(event) =>
                detectMention(
                  event.currentTarget.value,
                  event.currentTarget.selectionStart,
                )
              }
              onKeyDown={keyDown}
              onPaste={paste}
              aria-label={edit ? "Edit message" : "Message"}
              placeholder={
                edit
                  ? "Edit your message"
                  : conversation.type === "note_to_self"
                    ? "Note to self"
                    : "Message"
              }
              rows={1}
              maxLength={8000}
              spellCheck={spellCheck}
              disabled={sending || requestingMic}
            />
          )}
        </div>
        {!recording && (
          <>
            {canSend || edit ? (
              <button
                className="chat-send-button"
                aria-label={edit ? "Save edited message" : "Send message"}
                disabled={!canSend || sending || requestingMic}
                onClick={() => void submit()}
              >
                <Icon name={edit ? "check" : "send"} size={22} />
              </button>
            ) : (
              <button
                className="chat-icon-button"
                aria-label="Record a voice message"
                disabled={sending || requestingMic}
                onClick={() => void startRecording()}
              >
                <Icon name="mic" size={23} />
              </button>
            )}
            {!edit && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  onChange={pickFiles}
                />
                <button
                  className="chat-icon-button chat-attach-button"
                  aria-label="Attach files"
                  disabled={sending || requestingMic}
                  onClick={() => fileInput.current?.click()}
                >
                  <Icon name="plus" size={23} />
                </button>
              </>
            )}
          </>
        )}
      </div>
      <div
        className={`chat-composer-hint ${requestingMic || sending || recording || body.length > 7000 ? "is-active" : ""}`}
      >
        {requestingMic
          ? "Waiting for microphone permission…"
          : sending
            ? edit
              ? "Saving changes…"
              : "Sending attachments…"
            : recording
              ? "Voice recordings can be up to 5 minutes"
              : sendWithEnter
                ? "Shift + Enter for a new line"
                : "Ctrl / ⌘ + Enter to send"}
        {body.length > 7000 && (
          <span>{body.length.toLocaleString()} / 8,000</span>
        )}
      </div>
    </div>
  );
}
