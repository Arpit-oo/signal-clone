"use client";

import { useState } from "react";
import { DropdownMenu } from "radix-ui";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Conversation } from "@/lib/types";
import { useChat } from "@/stores/chat";
import { Button, Icon, Modal, errorMessage } from "@/components/ui";
import { WallpaperDialog } from "./WallpaperDialog";
import { SharedMediaDialog } from "./SharedMediaDialog";

const timers = [
  [0, "Off"],
  [2419200, "4 weeks"],
  [604800, "1 week"],
  [86400, "1 day"],
  [28800, "8 hours"],
  [3600, "1 hour"],
  [300, "5 minutes"],
  [30, "30 seconds"],
] as const;
const mutes = [
  [0, "Unmute"],
  [3600, "1 hour"],
  [28800, "8 hours"],
  [86400, "1 day"],
  [604800, "1 week"],
  [-1, "Always"],
] as const;

export function ChatOptionsMenu({
  conversation: c,
  onDetails,
  onBack,
}: {
  conversation: Conversation;
  onDetails: () => void;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [wallpaper, setWallpaper] = useState(false);
  const [media, setMedia] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "block" | null>(null);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function settings(patch: Parameters<typeof api.conversations.settings>[1]) {
    void act(async () =>
      useChat
        .getState()
        .upsertConversation(await api.conversations.settings(c.id, patch)),
    );
  }
  const item = (label: string, icon: string, action: () => void) => (
    <DropdownMenu.Item
      className="chat-menu-item"
      disabled={busy}
      onSelect={action}
    >
      <Icon name={icon} size={19} />
      {label}
    </DropdownMenu.Item>
  );
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          className="chat-icon-button"
          aria-label="Conversation options"
          title="Conversation options"
        >
          <Icon name="more" size={21} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="chat-options-menu"
            align="end"
            sideOffset={8}
            collisionPadding={12}
            aria-label={`Options for ${c.name}`}
          >
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className="chat-menu-item">
                <Icon name="clock" size={19} />
                Disappearing messages
                <Icon name="chevron-right" size={16} />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  className="chat-options-menu chat-options-submenu"
                  collisionPadding={12}
                  sideOffset={4}
                >
                  {timers.map(([seconds, label]) => (
                    <DropdownMenu.Item
                      key={seconds}
                      className="chat-menu-item"
                      disabled={busy || !c.is_member}
                      onSelect={() =>
                        void act(async () => {
                          useChat
                            .getState()
                            .upsertConversation(
                              await api.conversations.update(c.id, {
                                disappearing_seconds: seconds || null,
                              }),
                            );
                        })
                      }
                    >
                      <span className="chat-menu-check">
                        {(c.disappearing_seconds ?? 0) === seconds && (
                          <Icon name="check" size={17} />
                        )}
                      </span>
                      {label}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className="chat-menu-item">
                <Icon name="bell-off" size={19} />
                Mute notifications
                <Icon name="chevron-right" size={16} />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  className="chat-options-menu chat-options-submenu"
                  collisionPadding={12}
                  sideOffset={4}
                >
                  <DropdownMenu.Label className="chat-menu-label">
                    Mute this chat for…
                  </DropdownMenu.Label>
                  {mutes.map(([seconds, label]) => (
                    <DropdownMenu.Item
                      key={seconds}
                      className="chat-menu-item"
                      disabled={busy}
                      onSelect={() => settings({ mute_seconds: seconds })}
                    >
                      {label}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
            {item("Chat settings", "settings", onDetails)}
            {item("Chat background", "image", () => setWallpaper(true))}
            {item("All media", "attachment", () => setMedia(true))}
            <DropdownMenu.Separator className="chat-menu-separator" />
            {item("Mark as unread", "chat", () => {
              settings({ marked_unread: true });
              onBack();
            })}
            {item(c.is_pinned ? "Unpin chat" : "Pin chat", "pin", () =>
              settings({ is_pinned: !c.is_pinned }),
            )}
            {item(c.is_archived ? "Unarchive" : "Archive", "archive", () => {
              settings({ is_archived: !c.is_archived });
              onBack();
            })}
            {c.peer &&
              item(c.peer.is_blocked ? "Unblock" : "Block", "block", () =>
                setConfirm("block"),
              )}
            {item("Delete chat", "trash", () => setConfirm("delete"))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {wallpaper && (
        <WallpaperDialog
          conversationId={c.id}
          onClose={() => setWallpaper(false)}
        />
      )}
      {media && (
        <SharedMediaDialog
          conversationId={c.id}
          onClose={() => setMedia(false)}
        />
      )}
      {confirm && (
        <Modal
          title={
            confirm === "delete"
              ? "Delete chat?"
              : `${c.peer?.is_blocked ? "Unblock" : "Block"} ${c.name}?`
          }
          onClose={() => setConfirm(null)}
          dismissible={!busy}
        >
          <div className="ui-modal-body">
            <p>
              {confirm === "delete"
                ? "Your chat history will be cleared for you. Other people keep their messages."
                : "Blocking stops messages and calls between you and this person."}
            </p>
            <div className="form-actions">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    if (confirm === "delete") {
                      await api.conversations.remove(c.id);
                      useChat
                        .getState()
                        .handleEvent({
                          type: "conversation.removed",
                          data: { conversation_id: c.id },
                        });
                      onBack();
                    } else if (c.peer) {
                      if (c.peer.is_blocked)
                        await api.blocks.unblock(c.peer.id);
                      else await api.blocks.block(c.peer.id);
                      await useChat.getState().loadConversations();
                    }
                    setConfirm(null);
                  })
                }
              >
                {confirm === "delete"
                  ? "Delete"
                  : c.peer?.is_blocked
                    ? "Unblock"
                    : "Block"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
