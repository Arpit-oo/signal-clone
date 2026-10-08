"use client";

import Link from "next/link";
import { routes } from "@/lib/routes";
import { useSession } from "@/stores/session";
import { Avatar, Icon } from "@/components/ui";
import type { ConversationFilter } from "@/hooks/shell/useConversationList";

export default function NavigationRail({
  activeSection = "chats",
  filter,
  unreadCount,
  onFilterChange,
  onSettings,
  onCalls,
}: {
  activeSection?: "chats" | "stories";
  filter: ConversationFilter;
  unreadCount: number;
  onFilterChange: (filter: ConversationFilter) => void;
  onSettings: () => void;
  onCalls: () => void;
}) {
  const me = useSession((state) => state.me)!;
  return (
    <nav className="app-rail" aria-label="Main navigation">
      <button
        type="button"
        className="rail-button rail-top-menu"
        title="Open settings"
        aria-label="Main menu"
        onClick={() => onSettings()}
      >
        <svg
          width="23"
          height="23"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <button
        type="button"
        className={`rail-button ${activeSection === "chats" && filter !== "archive" ? "active" : ""}`}
        title="Conversations"
        aria-label="Conversations"
        aria-current={
          activeSection === "chats" && filter !== "archive" ? "page" : undefined
        }
        onClick={() => onFilterChange("all")}
      >
        <Icon name="chat" size={22} />
        {unreadCount > 0 && <span className="rail-dot" />}
      </button>
      <button
        type="button"
        className="rail-button"
        title="Calls · Coming soon"
        aria-label="Calls · Coming soon"
        onClick={() => onCalls()}
      >
        <svg
          width="23"
          height="23"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 3 4 4C1 6 5 13 8 16s10 7 12 4l1-3-5-3-2 2c-3-1-5-3-6-6l2-2-3-5Z" />
        </svg>
      </button>
      <Link
        href={routes.stories}
        className={`rail-button ${activeSection === "stories" ? "active" : ""}`}
        title="Stories"
        aria-label="Stories"
        aria-current={activeSection === "stories" ? "page" : undefined}
      >
        <svg
          width="23"
          height="23"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="8" y="3" width="12" height="18" rx="3" />
          <path d="m6 5-2 1c-1 .3-1.5 1.3-1.2 2.4l2.8 10" />
        </svg>
      </Link>
      <button
        type="button"
        className={`rail-button ${activeSection === "chats" && filter === "archive" ? "active" : ""}`}
        title="Archived conversations"
        aria-label="Archived conversations"
        aria-current={
          activeSection === "chats" && filter === "archive" ? "page" : undefined
        }
        onClick={() => onFilterChange("archive")}
      >
        <Icon name="archive" size={22} />
      </button>
      <span className="rail-spacer" />
      <button
        type="button"
        className="rail-button"
        aria-label="Settings"
        title="Settings"
        onClick={() => onSettings()}
      >
        <Icon name="settings" size={22} />
      </button>
      <button
        type="button"
        className="rail-profile"
        aria-label="Your profile"
        title="Your profile"
        onClick={() => onSettings()}
      >
        <Avatar
          name={me.display_name}
          color={me.avatar_color}
          url={me.avatar_url}
          size={34}
        />
      </button>
    </nav>
  );
}
