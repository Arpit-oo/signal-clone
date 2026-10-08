"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { authRoute, routes } from "@/lib/routes";
import type { Story } from "@/lib/types";
import { socket } from "@/lib/ws";
import { useSession } from "@/stores/session";
import Settings from "@/components/Settings";
import {
  Avatar,
  Button,
  ErrorText,
  Icon,
  IconButton,
  Spinner,
  errorMessage,
  useNow,
} from "@/components/ui";
import StoryComposer from "@/components/stories/StoryComposer";
import StoryViewer from "@/components/stories/StoryViewer";
import CallsDialog from "@/components/shell/CallsDialog";
import MobileTabs from "@/components/shell/MobileTabs";
import NavigationRail from "@/components/shell/NavigationRail";
import { useConversationList } from "@/hooks/shell/useConversationList";
import "@/components/stories/stories.css";

interface StoryGroup {
  author: Story["author"];
  stories: Story[];
  unseen: boolean;
  latest: string;
  isOwn: boolean;
}

export function storyTime(value: string, now: number) {
  const minutes = Math.max(
    0,
    Math.floor((now - new Date(value).getTime()) / 60000),
  );
  return minutes < 1
    ? "Just now"
    : minutes < 60
      ? `${minutes}m ago`
      : `${Math.floor(minutes / 60)}h ago`;
}

function StoriesApp() {
  const router = useRouter();
  const me = useSession((state) => state.me)!;
  const { unreadCount } = useConversationList("all");
  const now = useNow();
  const [feed, setFeed] = useState<{
    items: Story[];
    loading: boolean;
    error: string;
  }>({ items: [], loading: true, error: "" });
  const [composer, setComposer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [calls, setCalls] = useState(false);
  const [viewerAuthorId, setViewerAuthorId] = useState<number | null>(null);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++request.current;
    try {
      const items = await api.stories.list();
      if (sequence === request.current)
        setFeed({ items, loading: false, error: "" });
    } catch (cause) {
      if (sequence === request.current)
        setFeed((current) => ({
          ...current,
          loading: false,
          error: errorMessage(cause),
        }));
    }
  }, []);
  useEffect(() => {
    void refresh();
    let eventTimer: ReturnType<typeof setTimeout> | undefined;
    const removeEvent = socket.subscribe((event) => {
      if (!["story.changed", "me.updated", "user.updated"].includes(event.type))
        return;
      clearTimeout(eventTimer);
      eventTimer = setTimeout(() => void refresh(), 150);
    });
    const removeStatus = socket.onStatus((status) => {
      if (status === "open") void refresh();
    });
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    const timer = setInterval(visible, 60000);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", visible);
    return () => {
      request.current += 1;
      clearTimeout(eventTimer);
      clearInterval(timer);
      removeEvent();
      removeStatus();
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
    };
  }, [refresh]);

  const byAuthor = new Map<number, StoryGroup>();
  for (const story of feed.items) {
    if (new Date(story.expires_at).getTime() <= now) continue;
    const group = byAuthor.get(story.author.id);
    if (group) {
      group.stories.push(story);
      group.unseen ||= !story.is_own && !story.viewed_at;
      if (story.created_at > group.latest) group.latest = story.created_at;
    } else
      byAuthor.set(story.author.id, {
        author: story.author,
        stories: [story],
        unseen: !story.is_own && !story.viewed_at,
        latest: story.created_at,
        isOwn: story.is_own,
      });
  }
  const groups = [...byAuthor.values()].map((group) => ({
    ...group,
    stories: group.stories.sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id,
    ),
  }));
  const own = groups.find((group) => group.isOwn);
  const peers = groups
    .filter((group) => !group.isOwn)
    .sort(
      (a, b) =>
        Number(b.unseen) - Number(a.unseen) || b.latest.localeCompare(a.latest),
    );
  const active = groups.find((group) => group.author.id === viewerAuthorId);
  const markViewed = useCallback(async (id: number) => {
    await api.stories.view(id);
    setFeed((current) => ({
      ...current,
      items: current.items.map((story) =>
        story.id === id
          ? { ...story, viewed_at: new Date().toISOString() }
          : story,
      ),
    }));
  }, []);
  function row(group: StoryGroup) {
    const name = group.author.nickname || group.author.display_name;
    return (
      <button
        type="button"
        className="story-feed-row"
        key={group.author.id}
        aria-label={
          group.isOwn
            ? "View your story"
            : `View ${group.author.display_name}'s story`
        }
        onClick={() => setViewerAuthorId(group.author.id)}
      >
        <span className={`story-ring ${group.unseen ? "unseen" : ""}`}>
          <Avatar
            name={name}
            color={group.author.avatar_color}
            url={group.author.avatar_url}
            size={48}
          />
        </span>
        <span>
          <strong>{group.isOwn ? "My story" : name}</strong>
          <small>
            {group.stories.length}{" "}
            {group.stories.length === 1 ? "story" : "stories"} ·{" "}
            {storyTime(group.latest, now)}
          </small>
        </span>
        {group.unseen && (
          <i className="story-new-dot" aria-label="Unseen stories" />
        )}
        <Icon name="chevron-right" size={17} />
      </button>
    );
  }
  return (
    <main className="app-shell stories-app">
      <NavigationRail
        activeSection="stories"
        filter="all"
        unreadCount={unreadCount}
        onFilterChange={(filter) =>
          router.push(
            filter === "archive"
              ? `${routes.chats}?filter=archive`
              : routes.chats,
          )
        }
        onSettings={() => setSettings(true)}
        onCalls={() => setCalls(true)}
      />
      <section className="stories-list-pane" aria-label="Stories feed">
        <header className="stories-header">
          <button
            type="button"
            className="stories-mobile-profile"
            aria-label="Your profile"
            onClick={() => setSettings(true)}
          >
            <Avatar
              name={me.display_name}
              color={me.avatar_color}
              url={me.avatar_url}
              size={32}
            />
          </button>
          <h1>Stories</h1>
          <IconButton
            name="plus"
            label="Add story"
            onClick={() => setComposer(true)}
          />
        </header>
        <div className="stories-feed scroll-thin">
          {feed.loading ? (
            <div className="centered-state">
              <Spinner label="Loading stories" />
              <p>Loading stories…</p>
            </div>
          ) : (
            <>
              {feed.error && (
                <div className="stories-feed-error">
                  <ErrorText>{feed.error}</ErrorText>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setFeed((current) => ({ ...current, loading: true }));
                      void refresh();
                    }}
                  >
                    Retry stories
                  </Button>
                </div>
              )}
              <p className="stories-section-label">My story</p>
              {own ? (
                row(own)
              ) : (
                <button
                  type="button"
                  className="story-feed-row story-add-row"
                  onClick={() => setComposer(true)}
                  aria-label="Create your first story"
                >
                  <span className="story-add-avatar">
                    <Avatar
                      name={me.display_name}
                      color={me.avatar_color}
                      url={me.avatar_url}
                      size={48}
                    />
                    <i>
                      <Icon name="plus" size={13} />
                    </i>
                  </span>
                  <span>
                    <strong>Add to my story</strong>
                    <small>Share with people you choose</small>
                  </span>
                </button>
              )}
              {peers.map((group, index) => (
                <div key={group.author.id}>
                  {(!index || group.unseen !== peers[index - 1].unseen) && (
                    <p className="stories-section-label">
                      {group.unseen ? "New stories" : "Viewed"}
                    </p>
                  )}
                  {row(group)}
                </div>
              ))}
              {!peers.length && !feed.error && (
                <div className="stories-empty">
                  <Icon name="image" size={35} />
                  <h2>No stories from your people yet</h2>
                  <p>Stories shared with you appear here for 24 hours.</p>
                </div>
              )}
            </>
          )}
        </div>
        <p className="stories-expiry-note">
          <Icon name="clock" size={14} />
          Stories expire after 24 hours
        </p>
        <MobileTabs
          activeSection="stories"
          unreadCount={unreadCount}
          onChats={() => router.push(routes.chats)}
        />
      </section>
      <section className="stories-idle">
        <Icon name="image" size={62} />
        <h2>Stories</h2>
        <p>Select a story to view it.</p>
        <Button variant="secondary" onClick={() => setComposer(true)}>
          <Icon name="plus" size={18} />
          Create a story
        </Button>
      </section>
      {composer && (
        <StoryComposer
          onClose={() => setComposer(false)}
          onCreated={(story) => {
            setFeed((current) => ({
              items: [
                story,
                ...current.items.filter((item) => item.id !== story.id),
              ],
              loading: false,
              error: "",
            }));
            setComposer(false);
            void refresh();
          }}
        />
      )}
      {active && (
        <StoryViewer
          key={active.author.id}
          stories={active.stories}
          initialIndex={Math.max(
            0,
            active.stories.findIndex((story) => !story.viewed_at),
          )}
          onClose={() => setViewerAuthorId(null)}
          onViewed={markViewed}
          onRefresh={() => void refresh()}
          onDeleted={(id) => {
            setFeed((current) => ({
              ...current,
              items: current.items.filter((story) => story.id !== id),
            }));
            if (active.stories.length === 1) setViewerAuthorId(null);
          }}
        />
      )}
      {calls && <CallsDialog onClose={() => setCalls(false)} />}
      {settings && (
        <Settings
          onClose={() => {
            setSettings(false);
            void refresh();
          }}
        />
      )}
    </main>
  );
}

export default function StoriesScreen() {
  const status = useSession((state) => state.status);
  const me = useSession((state) => state.me);
  const error = useSession((state) => state.error);
  const router = useRouter();
  useEffect(() => {
    if (status === "anonymous")
      router.replace(authRoute("login", routes.stories));
    else if (status === "authenticated" && !me?.display_name)
      router.replace(authRoute("signup", routes.stories));
  }, [status, me?.display_name, router]);
  if (status === "unavailable")
    return (
      <main className="app-loading">
        <h2>Let’s reconnect</h2>
        <ErrorText>{error}</ErrorText>
        <Button onClick={() => void useSession.getState().restore()}>
          Try again
        </Button>
      </main>
    );
  if (status !== "authenticated" || !me?.display_name)
    return (
      <main className="app-loading">
        <Spinner />
        <p>Opening stories…</p>
      </main>
    );
  return <StoriesApp key={me.id} />;
}
