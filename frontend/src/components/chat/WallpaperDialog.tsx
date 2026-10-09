"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { WALLPAPERS, wallpaperStyle } from "@/lib/wallpapers";
import { useChat } from "@/stores/chat";
import {
  Button,
  ErrorText,
  Icon,
  Modal,
  Spinner,
  errorMessage,
} from "@/components/ui";

export function WallpaperDialog({
  conversationId,
  onClose,
}: {
  conversationId: number;
  onClose: () => void;
}) {
  const conversation = useChat((s) => s.conversations[conversationId]);
  const [selection, setSelection] = useState(conversation?.wallpaper ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function save(file?: File) {
    setBusy(true);
    setError("");
    try {
      const updated = file
        ? await api.conversations.uploadWallpaper(conversationId, file)
        : await api.conversations.settings(conversationId, {
            wallpaper: selection,
          });
      useChat.getState().upsertConversation(updated);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Chat background"
      onClose={onClose}
      dismissible={!busy}
      className="wallpaper-dialog"
    >
      <div className="ui-modal-body">
        <p>
          Choose a background for {conversation?.name}. Only you will see it.
        </p>
        <div
          className={`wallpaper-preview ${selection ? "has-wallpaper" : ""}`}
          style={wallpaperStyle(selection, conversationId)}
        >
          <span className="wallpaper-example incoming">
            Make yourself at home.
          </span>
          <span className="wallpaper-example outgoing">A little more you.</span>
        </div>
        <div className="wallpaper-grid" role="group" aria-label="Backgrounds">
          <button
            type="button"
            aria-pressed={selection === null}
            disabled={busy}
            onClick={() => setSelection(null)}
            className="wallpaper-choice"
          >
            <span className="wallpaper-swatch wallpaper-default">
              <Icon name="close" />
            </span>
            Default
          </button>
          {Object.entries(WALLPAPERS).map(([id, item]) => (
            <button
              key={id}
              type="button"
              disabled={busy}
              aria-pressed={selection === id}
              onClick={() => setSelection(id)}
              className="wallpaper-choice"
            >
              <span
                className="wallpaper-swatch"
                style={{ background: item.background, color: id === "night" ? "white" : undefined }}
              >
                {selection === id && <Icon name="check" />}
              </span>
              {item.name}
            </button>
          ))}
        </div>
        <input
          ref={input}
          type="file"
          hidden
          accept="image/jpeg,image/png,image/webp"
          aria-label="Upload chat background"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (file.size > 10 * 1024 * 1024) {
              setError("Choose an image under 10 MB.");
              return;
            }
            void save(file);
          }}
        />
        <ErrorText>{error}</ErrorText>
        <div className="form-actions">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Icon name="image" size={18} />
            Upload image
          </Button>
          <Button
            disabled={busy || selection === conversation?.wallpaper}
            onClick={() => void save()}
          >
            {busy && <Spinner />}Set background
          </Button>
        </div>
        <p className="subtle-note">
          JPEG, PNG or WebP · up to 10 MB. Saved to your account.
        </p>
      </div>
    </Modal>
  );
}
