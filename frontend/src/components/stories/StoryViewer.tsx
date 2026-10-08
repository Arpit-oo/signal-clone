/* eslint-disable @next/next/no-img-element -- Protected story media uses authenticated URLs. */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, fileUrl } from "@/lib/api";
import { conversationRoute } from "@/lib/routes";
import type { Story, StoryView } from "@/lib/types";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import {
  Avatar,
  Button,
  ErrorText,
  Icon,
  IconButton,
  Modal,
  Spinner,
  errorMessage,
  useNow,
} from "@/components/ui";

function PlaybackIcon({
  kind,
}: {
  kind: "play" | "pause" | "sound" | "muted" | "eye";
}) {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "pause" ? (
        <>
          <path d="M8 5v14M16 5v14" strokeWidth="4" />
        </>
      ) : kind === "play" ? (
        <path d="m7 4 13 8-13 8V4Z" fill="currentColor" stroke="none" />
      ) : kind === "eye" ? (
        <>
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M11 4 6 8H3v8h3l5 4V4Z" />
          {kind === "sound" ? (
            <>
              <path d="M15 8c3 2 3 6 0 8M18 4c6 4 6 12 0 16" />
            </>
          ) : (
            <path d="m16 9 6 6m0-6-6 6" />
          )}
        </>
      )}
    </svg>
  );
}

function StorySlide({
  story,
  index,
  total,
  paused,
  onPause,
  onNext,
  onPrevious,
  onClose,
  onViewed,
  onViews,
  onDelete,
  onReply,
  onRefresh,
  blocked,
}: {
  story: Story;
  index: number;
  total: number;
  paused: boolean;
  onPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  onViewed: (id: number) => Promise<void>;
  onViews: () => void;
  onDelete: () => void;
  onReply: () => void;
  onRefresh: () => void;
  blocked: boolean;
}) {
  const now = useNow();
  const receiptsEnabled = useSession(
    (state) => state.me?.read_receipts_enabled,
  );
  const [ready, setReady] = useState(story.kind === "text");
  const [hidden, setHidden] = useState(
    () => typeof document !== "undefined" && document.hidden,
  );
  const [progress, setProgress] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [videoBlocked, setVideoBlocked] = useState(false);
  const [muted, setMuted] = useState(true);
  const [mediaError, setMediaError] = useState("");
  const [viewError, setViewError] = useState("");
  const [mediaAttempt, setMediaAttempt] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const elapsed = useRef(0);
  const attemptedView = useRef(!!story.viewed_at || story.is_own);
  const savingView = useRef(false);
  const nextRef = useRef(onNext);
  useEffect(() => {
    nextRef.current = onNext;
  }, [onNext]);
  useEffect(() => {
    const change = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  const saveView = useCallback(async () => {
    if (savingView.current || story.is_own) return;
    attemptedView.current = true;
    savingView.current = true;
    setViewError("");
    try {
      await onViewed(story.id);
    } catch (cause) {
      setViewError(errorMessage(cause));
    } finally {
      savingView.current = false;
    }
  }, [story.id, story.is_own, onViewed]);
  useEffect(() => {
    if (ready && !hidden && !mediaError && !attemptedView.current)
      void saveView();
  }, [ready, hidden, mediaError, saveView]);
  const stopped =
    paused ||
    hidden ||
    blocked ||
    !ready ||
    !!mediaError ||
    buffering ||
    videoBlocked;
  const duration =
    story.kind === "video"
      ? Math.max(8000, videoDuration * 1000)
      : story.kind === "text"
        ? Math.min(20000, Math.max(8000, story.body.length * 35))
        : 8000;
  useEffect(() => {
    if (stopped) return;
    let previous = performance.now();
    let finished = false;
    const timer = setInterval(() => {
      const time = performance.now();
      elapsed.current += time - previous;
      previous = time;
      const value = Math.min(100, (elapsed.current / duration) * 100);
      setProgress(value);
      if (value >= 100 && !finished) {
        finished = true;
        clearInterval(timer);
        nextRef.current();
      }
    }, 100);
    return () => clearInterval(timer);
  }, [stopped, duration]);
  useEffect(() => {
    const player = video.current;
    if (!player || story.kind !== "video" || !ready) return;
    if (paused || hidden || blocked || mediaError) {
      player.pause();
      return;
    }
    let active = true;
    void player
      .play()
      .then(() => {
        if (active) setVideoBlocked(false);
      })
      .catch(() => {
        if (active) setVideoBlocked(true);
      });
    return () => {
      active = false;
      player.pause();
    };
  }, [story.kind, ready, paused, hidden, blocked, mediaError]);
  const mediaUrl = story.media ? fileUrl(story.media.url) : undefined;
  const source =
    mediaUrl && mediaAttempt
      ? `${mediaUrl}${mediaUrl.includes("?") ? "&" : "?"}retry=${mediaAttempt}`
      : mediaUrl;
  const ageMinutes = Math.max(
    0,
    Math.floor((now - new Date(story.created_at).getTime()) / 60000),
  );
  const age =
    ageMinutes < 1
      ? "now"
      : ageMinutes < 60
        ? `${ageMinutes}m`
        : `${Math.floor(ageMinutes / 60)}h`;
  return (
    <>
      <div
        className="story-viewer-backdrop"
        aria-hidden="true"
        style={
          story.media && story.kind === "image"
            ? { backgroundImage: `url("${mediaUrl}")` }
            : { backgroundColor: story.color }
        }
      />
      <div
        className="story-slide"
        tabIndex={0}
        aria-label={`Story ${index + 1} of ${total}`}
        style={{ backgroundColor: story.color }}
      >
        {story.kind === "image" && (
          <img
            key={source}
            className="story-viewer-media"
            src={source}
            alt={story.body || `Photo story by ${story.author.display_name}`}
            onLoad={() => setReady(true)}
            onError={() => {
              setReady(false);
              setMediaError(
                "This photo couldn’t be loaded. It may have expired, or your connection may be interrupted.",
              );
              onRefresh();
            }}
          />
        )}
        {story.kind === "video" && (
          <video
            key={source}
            ref={video}
            className="story-viewer-media"
            src={source}
            muted={muted}
            playsInline
            preload="auto"
            aria-label={`Video story by ${story.author.display_name}`}
            onLoadedData={() => {
              setReady(true);
              setMediaError("");
            }}
            onLoadedMetadata={(event) => {
              const value = event.currentTarget.duration;
              setVideoDuration(Number.isFinite(value) ? value : 0);
            }}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => setBuffering(false)}
            onEnded={() => setBuffering(false)}
            onError={() => {
              setReady(false);
              setBuffering(false);
              setMediaError(
                "This video couldn’t be played. Try again or check whether your browser supports this video.",
              );
              onRefresh();
            }}
          />
        )}
        {story.kind === "text" && (
          <div
            className={`story-viewer-text ${story.body.length > 1000 ? "long-text" : story.body.length > 300 ? "medium-text" : ""}`}
          >
            <p>{story.body}</p>
          </div>
        )}
        <IconButton
          className="story-close"
          name="close"
          label="Close story"
          onClick={onClose}
          disabled={blocked}
        />
        {!ready && !mediaError && (
          <div className="story-media-state">
            <Spinner label="Loading story media" />
            <span>Loading story…</span>
          </div>
        )}
        {mediaError && (
          <div className="story-media-state">
            <ErrorText>{mediaError}</ErrorText>
            <Button
              variant="secondary"
              onClick={() => {
                setReady(false);
                setMediaError("");
                setBuffering(false);
                setVideoBlocked(false);
                setMediaAttempt((value) => value + 1);
              }}
            >
              Retry media
            </Button>
          </div>
        )}
        {videoBlocked && !mediaError && (
          <button
            type="button"
            className="story-play-overlay"
            aria-label="Play video"
            onClick={() => {
              void video.current
                ?.play()
                .then(() => {
                  setVideoBlocked(false);
                  setBuffering(false);
                })
                .catch(() => {
                  setVideoBlocked(true);
                  setMediaError(
                    "Playback couldn't start. Retry the video or choose another story.",
                  );
                });
            }}
          >
            <PlaybackIcon kind="play" />
            Play video
          </button>
        )}
        <button
          type="button"
          className="story-navigation story-previous"
          aria-label="Previous story"
          disabled={index === 0 || blocked}
          onClick={onPrevious}
        >
          <Icon name="chevron-left" size={23} />
        </button>
        <button
          type="button"
          className="story-navigation story-next"
          aria-label="Next story"
          disabled={blocked}
          onClick={onNext}
        >
          <Icon name="chevron-right" size={23} />
        </button>
        <div className="story-bottom-overlay">
          {story.kind !== "text" && story.body && (
            <p className="story-viewer-caption">{story.body}</p>
          )}
          {viewError && (
            <div className="story-view-error">
              <ErrorText>{viewError}</ErrorText>
              <button type="button" onClick={() => void saveView()}>
                Retry view
              </button>
            </div>
          )}
          <div className="story-author-line">
            <Avatar
              name={story.author.display_name}
              color={story.author.avatar_color}
              url={story.author.avatar_url}
              size={35}
            />
            <strong>
              {story.is_own ? "My story" : story.author.display_name}
            </strong>
            <small>{age}</small>
            <span className="story-author-spacer" />
            <button
              type="button"
              className="story-control"
              aria-label={paused ? "Resume story" : "Pause story"}
              disabled={blocked}
              onClick={onPause}
            >
              <PlaybackIcon kind={paused ? "play" : "pause"} />
            </button>
            {story.kind === "video" && (
              <button
                type="button"
                className="story-control"
                aria-label={muted ? "Unmute story" : "Mute story"}
                disabled={blocked}
                onClick={() => setMuted((value) => !value)}
              >
                <PlaybackIcon kind={muted ? "muted" : "sound"} />
              </button>
            )}
            {story.is_own && (
              <button
                type="button"
                className="story-control"
                aria-label="Delete story"
                disabled={blocked}
                onClick={onDelete}
              >
                <Icon name="trash" size={19} />
              </button>
            )}
          </div>
          <div
            className="story-progress"
            role="progressbar"
            aria-label="Story progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.floor(progress)}
          >
            {Array.from({ length: total }, (_, step) => (
              <span key={step}>
                <i
                  style={{
                    width: `${step < index ? 100 : step > index ? 0 : progress}%`,
                  }}
                />
              </span>
            ))}
          </div>
        </div>
      </div>
      <footer className="story-viewer-footer">
        {story.is_own ? (
          <button
            type="button"
            disabled={blocked}
            onClick={onViews}
            aria-label="Story viewers"
          >
            <PlaybackIcon kind="eye" />
            <span>
              {!receiptsEnabled || story.view_count === null
                ? "Views"
                : `${story.view_count} ${story.view_count === 1 ? "view" : "views"}`}
            </span>
          </button>
        ) : (
          <button
            type="button"
            disabled={blocked}
            onClick={onReply}
            aria-label="Reply to story"
          >
            <Icon name="reply" size={23} />
            Reply
          </button>
        )}
        <span className="story-key-hint">← → to navigate · Space to pause</span>
      </footer>
    </>
  );
}

export default function StoryViewer({
  stories,
  initialIndex,
  onClose,
  onViewed,
  onDeleted,
  onRefresh,
}: {
  stories: Story[];
  initialIndex: number;
  onClose: () => void;
  onViewed: (id: number) => Promise<void>;
  onDeleted: (id: number) => void;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const me = useSession((state) => state.me)!;
  const [index, setIndex] = useState(initialIndex);
  const [paused, setPaused] = useState(false);
  const [views, setViews] = useState<{
    loading: boolean;
    items: StoryView[];
    error: string;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState("");
  const content = useRef<HTMLDivElement>(null);
  const viewsRequest = useRef(0);
  const currentIndex = Math.min(index, stories.length - 1);
  const story = stories[currentIndex];
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      content.current?.querySelector<HTMLElement>(".story-slide")?.focus(),
    );
    return () => {
      cancelAnimationFrame(frame);
      viewsRequest.current += 1;
    };
  }, [story.id]);
  const blocked = !!views || confirmDelete || replying;
  const next = () => {
    if (currentIndex + 1 < stories.length) {
      setIndex(currentIndex + 1);
      setError("");
    } else onClose();
  };
  const previous = () => {
    setIndex(Math.max(0, currentIndex - 1));
    setError("");
  };
  async function loadViews() {
    const sequence = ++viewsRequest.current;
    setViews({ loading: true, items: [], error: "" });
    try {
      const items = await api.stories.views(story.id);
      if (sequence === viewsRequest.current)
        setViews({ loading: false, items, error: "" });
    } catch (cause) {
      if (sequence === viewsRequest.current)
        setViews({ loading: false, items: [], error: errorMessage(cause) });
    }
  }
  async function remove() {
    setDeleting(true);
    setError("");
    try {
      await api.stories.remove(story.id);
      onDeleted(story.id);
      setConfirmDelete(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setDeleting(false);
    }
  }
  async function reply() {
    setReplying(true);
    setError("");
    try {
      const conversation = await api.conversations.createDirect(
        story.author.id,
      );
      useChat.getState().upsertConversation(conversation);
      router.push(conversationRoute(conversation.id), { scroll: false });
    } catch (cause) {
      setError(errorMessage(cause));
      setReplying(false);
    }
  }
  return (
    <Modal
      title={`Story by ${story.author.display_name}`}
      onClose={onClose}
      className="story-viewer"
      dismissible={!deleting && !replying}
    >
      <div
        ref={content}
        className="story-viewer-content"
        onKeyDown={(event) => {
          if (blocked) return;
          if (event.key === "ArrowRight") {
            event.preventDefault();
            next();
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            previous();
          } else if (
            event.code === "Space" &&
            !(event.target instanceof HTMLButtonElement)
          ) {
            event.preventDefault();
            setPaused((value) => !value);
          }
        }}
      >
        <StorySlide
          key={story.id}
          story={story}
          index={currentIndex}
          total={stories.length}
          paused={paused}
          onPause={() => setPaused((value) => !value)}
          onNext={next}
          onPrevious={previous}
          onClose={onClose}
          onViewed={onViewed}
          onViews={() => void loadViews()}
          onDelete={() => {
            setError("");
            setConfirmDelete(true);
          }}
          onReply={() => void reply()}
          onRefresh={onRefresh}
          blocked={blocked}
        />
        {replying && (
          <p className="story-viewer-notice" role="status">
            <Spinner label="Opening reply" />
            Opening chat…
          </p>
        )}
        {error && !confirmDelete && (
          <div className="story-viewer-notice">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
      </div>
      {views && (
        <Modal
          title="Story viewers"
          onClose={() => {
            viewsRequest.current += 1;
            setViews(null);
          }}
          className="story-views-modal"
        >
          <div className="ui-modal-body">
            {!me.read_receipts_enabled ? (
              <p>
                Turn on read receipts in Settings → Privacy to see who viewed
                your stories.
              </p>
            ) : (
              <>
                <p className="subtle-note">
                  Only people with read receipts turned on appear here.
                </p>
                {views.loading ? (
                  <div className="centered-state">
                    <Spinner label="Loading story viewers" />
                  </div>
                ) : views.error ? (
                  <>
                    <ErrorText>{views.error}</ErrorText>
                    <Button
                      variant="secondary"
                      onClick={() => void loadViews()}
                    >
                      Retry viewers
                    </Button>
                  </>
                ) : views.items.length ? (
                  <div className="story-viewers-list">
                    {views.items.map((view) => (
                      <div className="story-view-person" key={view.user.id}>
                        <Avatar
                          name={view.user.display_name}
                          color={view.user.avatar_color}
                          url={view.user.avatar_url}
                          size={38}
                        />
                        <span>
                          <strong>{view.user.display_name}</strong>
                          <small>
                            Viewed {new Date(view.viewed_at).toLocaleString()}
                          </small>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p>No visible views yet.</p>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
      {confirmDelete && (
        <Modal
          title="Delete story?"
          role="alertdialog"
          onClose={() => {
            if (!deleting) {
              setConfirmDelete(false);
              setError("");
            }
          }}
          dismissible={!deleting}
        >
          <div className="ui-modal-body">
            <p>This story will be removed for everyone you shared it with.</p>
            <ErrorText>{error}</ErrorText>
            <div className="form-actions">
              <Button
                variant="secondary"
                disabled={deleting}
                onClick={() => {
                  setConfirmDelete(false);
                  setError("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={deleting}
                onClick={() => void remove()}
              >
                {deleting && <Spinner />}Delete story
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
