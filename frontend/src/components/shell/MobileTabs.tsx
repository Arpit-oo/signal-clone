"use client";

import Link from "next/link";
import { routes } from "@/lib/routes";
import { Icon } from "@/components/ui";

export default function MobileTabs({
  unreadCount,
  onChats,
}: {
  unreadCount: number;
  onChats: () => void;
}) {
  return (
    <nav className="sidebar-mobile-tabs" aria-label="Mobile navigation">
      <button type="button" aria-current="page" onClick={onChats}>
        <span>
          <Icon name="chat" size={24} />
          {unreadCount > 0 && <i>{unreadCount}</i>}
        </span>
        Chats
      </button>
      <Link href={routes.stories} aria-label="Stories">
        <svg
          width="24"
          height="24"
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
        Stories
      </Link>
    </nav>
  );
}
