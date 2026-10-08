"use client";

import { useEffect, useState, type ReactNode } from "react";
import { socket, type SocketStatus } from "@/lib/ws";
import { useSession } from "@/stores/session";
import { Avatar, Icon, IconButton } from "@/components/ui";
import {
  useConversationList,
  type ConversationFilter,
} from "@/hooks/shell/useConversationList";
import MobileTabs from "./MobileTabs";

export default function ConversationSidebar({
  filter,
  query,
  onQueryChange,
  onFilterChange,
  onSettings,
  onNewChat,
  statusMessage,
  children,
}: {
  filter: ConversationFilter;
  query: string;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: ConversationFilter) => void;
  onSettings: () => void;
  onNewChat: () => void;
  statusMessage: string;
  children: ReactNode;
}) {
  const me = useSession((state) => state.me)!;
  const { archiveCount, unreadCount, pinnedCount } =
    useConversationList(filter);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>(socket.status);
  useEffect(() => socket.onStatus(setSocketStatus), []);
  return (
    <aside className="app-sidebar">
      <header className="sidebar-header">
        <button
          type="button"
          className="sidebar-mobile-profile"
          aria-label="Your profile"
          onClick={() => onSettings()}
        >
          <Avatar
            name={me.display_name}
            color={me.avatar_color}
            url={me.avatar_url}
            size={32}
          />
        </button>
        <h1>{filter === "archive" ? "Archived" : "Chats"}</h1>
        <div className="sidebar-header-actions">
          <IconButton
            name="compose"
            label="New conversation"
            onClick={() => onNewChat()}
          />
          <IconButton
            name="more"
            label="Open settings"
            className="sidebar-desktop-settings"
            onClick={() => onSettings()}
          />
        </div>
      </header>
      <div className="sidebar-tools">
        <label className="search-field">
          <Icon name="search" size={18} />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search"
            aria-label="Search all conversations"
            maxLength={200}
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onQueryChange("")}
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </label>
        <div className="sidebar-filters">
          <button
            type="button"
            className={filter === "pinned" ? "selected" : ""}
            aria-pressed={filter === "pinned"}
            onClick={() => onFilterChange("pinned")}
          >
            Pinned{pinnedCount > 0 && <span>{pinnedCount}</span>}
          </button>
          <button
            type="button"
            className={filter === "all" ? "selected" : ""}
            onClick={() => onFilterChange("all")}
          >
            All
          </button>
          <button
            type="button"
            className={filter === "unread" ? "selected" : ""}
            onClick={() => onFilterChange("unread")}
          >
            Unread{unreadCount > 0 && <span>{unreadCount}</span>}
          </button>
          <button
            type="button"
            className={filter === "archive" ? "selected" : ""}
            onClick={() => onFilterChange("archive")}
          >
            Archived{archiveCount > 0 && <span>{archiveCount}</span>}
          </button>
        </div>
      </div>
      {socketStatus !== "open" && (
        <button
          type="button"
          className="connection-banner"
          onClick={() => socket.kick()}
        >
          <span className="connection-dot" />
          {socketStatus === "connecting"
            ? "Connecting…"
            : "Connection interrupted · Retry"}
        </button>
      )}
      {children}
      {statusMessage && (
        <p className="sidebar-feedback" role="status">
          <Icon name="check" size={15} />
          {statusMessage}
        </p>
      )}
      <MobileTabs
        unreadCount={unreadCount}
        onChats={() => onFilterChange("all")}
      />
    </aside>
  );
}
