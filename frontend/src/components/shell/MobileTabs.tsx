"use client";

import Link from "next/link";
import { routes } from "@/lib/routes";
import { Icon } from "@/components/ui";

export default function MobileTabs({
  activeSection = "chats",
  unreadCount,
  onChats,
}: {
  activeSection?: "chats" | "stories";
  unreadCount: number;
  onChats: () => void;
}) {
  return (
    <nav className="sidebar-mobile-tabs" aria-label="Mobile navigation">
      <button
        type="button"
        aria-current={activeSection === "chats" ? "page" : undefined}
        onClick={onChats}
      >
        <span>
          <Icon
            name={activeSection === "chats" ? "chat-filled" : "chat"}
            size={24}
          />
          {unreadCount > 0 && <i>{unreadCount > 99 ? "99+" : unreadCount}</i>}
        </span>
        Chats
      </button>
      <Link
        href={routes.stories}
        aria-label="Stories"
        aria-current={activeSection === "stories" ? "page" : undefined}
      >
        <Icon
          name={activeSection === "stories" ? "stories-filled" : "stories"}
          size={24}
        />
        Stories
      </Link>
    </nav>
  );
}
