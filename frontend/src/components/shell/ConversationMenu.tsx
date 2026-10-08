"use client";

import type { RefObject } from "react";
import type { Conversation } from "@/lib/types";
import type { ConversationSettingsPatch } from "@/hooks/shell/useConversationActions";
import { ErrorText, Icon } from "@/components/ui";

export default function ConversationMenu({
  menu,
  position,
  menuRef,
  busy,
  actionError,
  now,
  onClose,
  onUpdate,
  onToggleRead,
  onDetails,
}: {
  menu: Conversation;
  position: { left: number; top: number };
  menuRef: RefObject<HTMLDivElement | null>;
  busy: boolean;
  actionError: string;
  now: number;
  onClose: () => void;
  onUpdate: (patch: ConversationSettingsPatch) => void;
  onToggleRead: () => void;
  onDetails: (id: number) => void;
}) {
  return (
    <>
      <button
        className="menu-scrim"
        aria-label="Close conversation menu"
        type="button"
        onClick={() => onClose()}
      />
      <div
        ref={menuRef}
        className="conversation-context-menu ui-menu"
        style={{
          left: position.left,
          top: position.top,
          right: "auto",
        }}
        role="menu"
        aria-label={`Options for ${menu.name}`}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          );
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    items.length) %
                  items.length;
          items[next]?.focus();
        }}
      >
        <strong>{menu.peer?.nickname || menu.name}</strong>
        <button
          role="menuitem"
          type="button"
          disabled={busy || menu.is_archived}
          onClick={() => void onUpdate({ is_pinned: !menu.is_pinned })}
        >
          <Icon name="pin" size={17} />
          {menu.is_pinned ? "Unpin" : "Pin"} conversation
        </button>
        <button
          role="menuitem"
          type="button"
          disabled={busy}
          onClick={() => void onUpdate({ is_archived: !menu.is_archived })}
        >
          <Icon name="archive" size={17} />
          {menu.is_archived ? "Unarchive" : "Archive"}
        </button>
        <button
          role="menuitem"
          type="button"
          disabled={busy}
          onClick={() => void onToggleRead()}
        >
          <Icon name="chat" size={17} />
          {menu.unread_count > 0 || menu.marked_unread
            ? "Mark as read"
            : "Mark as unread"}
        </button>
        <button
          role="menuitem"
          type="button"
          disabled={busy}
          onClick={() =>
            void onUpdate({
              mute_seconds:
                menu.muted_until && new Date(menu.muted_until).getTime() > now
                  ? 0
                  : -1,
            })
          }
        >
          <Icon name="bell-off" size={17} />
          {menu.muted_until && new Date(menu.muted_until).getTime() > now
            ? "Unmute"
            : "Mute"}{" "}
          notifications
        </button>
        <button
          role="menuitem"
          type="button"
          disabled={busy}
          onClick={() => onDetails(menu.id)}
        >
          <Icon name="info" size={17} />
          Conversation details
        </button>
        <ErrorText>{actionError}</ErrorText>
      </div>
    </>
  );
}
