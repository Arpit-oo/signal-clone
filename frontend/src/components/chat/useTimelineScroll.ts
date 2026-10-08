"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ChatMessage } from "@/lib/types";
import { useChat } from "@/stores/chat";

type ChatState = ReturnType<typeof useChat.getState>;
export type TimelineBucket = ChatState["buckets"][number];
type FocusMessage = ChatState["focusMessage"];

interface TimelineScrollOptions {
  conversationId: number;
  bucket?: TimelineBucket;
  messages: ChatMessage[];
  focusMessage: FocusMessage;
  unreadCount?: number;
}

interface ScrollAnchor {
  elementId: string;
  offset: number;
}

function visibleMessageAnchor(viewport: HTMLDivElement): ScrollAnchor | null {
  const bounds = viewport.getBoundingClientRect();
  for (const message of viewport.querySelectorAll<HTMLElement>(
    "[id^='chat-message-']",
  )) {
    const messageBounds = message.getBoundingClientRect();
    if (
      messageBounds.bottom > bounds.top &&
      messageBounds.top < bounds.bottom
    ) {
      return { elementId: message.id, offset: messageBounds.top - bounds.top };
    }
  }
  return null;
}

function restoreMessageAnchor(
  viewport: HTMLDivElement,
  anchor: ScrollAnchor | null,
): boolean {
  if (!anchor) return false;
  const message = document.getElementById(anchor.elementId);
  if (!message || !viewport.contains(message)) return false;
  viewport.scrollTop +=
    message.getBoundingClientRect().top -
    viewport.getBoundingClientRect().top -
    anchor.offset;
  return true;
}

/** Owns history loading and keeps the visible message stable across content/viewport changes. */
export function useTimelineScroll({
  conversationId,
  bucket,
  messages,
  focusMessage,
  unreadCount,
}: TimelineScrollOptions) {
  const [nearBottom, setNearBottom] = useState(true);
  const timeline = useRef<HTMLDivElement>(null);
  const timelineContent = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const initialScrolled = useRef(false);
  const previousLastId = useRef<number | null>(null);
  const scrollSnapshot = useRef<{
    height: number;
    top: number;
    firstId: number;
    anchor: ScrollAnchor | null;
  } | null>(null);
  const focusedNonce = useRef<number | null>(null);
  const readingAnchor = useRef<ScrollAnchor | null>(null);
  const viewportSize = useRef<{
    width: number;
    height: number;
    contentHeight: number;
  } | null>(null);

  const rememberScrollPosition = useCallback(() => {
    const viewport = timeline.current;
    if (!viewport) return;
    readingAnchor.current = visibleMessageAnchor(viewport);
    viewportSize.current = {
      width: viewport.clientWidth,
      height: viewport.clientHeight,
      contentHeight: viewport.scrollHeight,
    };
  }, []);

  const preserveScrollPosition = useCallback(() => {
    const viewport = timeline.current;
    if (!viewport || !initialScrolled.current) return;
    if (atBottom.current) viewport.scrollTop = viewport.scrollHeight;
    else if (!scrollSnapshot.current)
      restoreMessageAnchor(viewport, readingAnchor.current);
    rememberScrollPosition();
  }, [rememberScrollPosition]);

  useLayoutEffect(() => {
    const viewport = timeline.current;
    const content = timelineContent.current;
    if (!viewport || !content) return;
    const observer = new ResizeObserver(preserveScrollPosition);
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  }, [preserveScrollPosition]);

  useEffect(() => {
    const state = useChat.getState();
    if (!state.buckets[conversationId]?.loaded)
      void state.loadLatest(conversationId);
    void state.loadDetail(conversationId);
  }, [conversationId]);

  useLayoutEffect(() => {
    const viewport = timeline.current;
    if (!viewport || !bucket?.loaded) return;
    if (
      focusMessage?.conversationId === conversationId &&
      focusMessage.nonce !== focusedNonce.current
    ) {
      const target = document.getElementById(
        `chat-message-${focusMessage.messageId}`,
      );
      if (target) {
        focusedNonce.current = focusMessage.nonce;
        initialScrolled.current = true;
        viewport.scrollTop +=
          target.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top -
          (viewport.clientHeight - target.clientHeight) / 2;
        target.classList.remove("chat-focused");
        requestAnimationFrame(() => target.classList.add("chat-focused"));
        atBottom.current =
          viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
          100;
        rememberScrollPosition();
      }
      return;
    }
    if (
      scrollSnapshot.current &&
      messages[0]?.id !== scrollSnapshot.current.firstId
    ) {
      if (!restoreMessageAnchor(viewport, scrollSnapshot.current.anchor)) {
        viewport.scrollTop =
          scrollSnapshot.current.top +
          viewport.scrollHeight -
          scrollSnapshot.current.height;
      }
      scrollSnapshot.current = null;
    } else {
      const last = messages.at(-1);
      const newMessage = last?.id !== previousLastId.current;
      if (!initialScrolled.current || (newMessage && atBottom.current)) {
        viewport.scrollTop = viewport.scrollHeight;
        initialScrolled.current = true;
      } else restoreMessageAnchor(viewport, readingAnchor.current);
      previousLastId.current = last?.id ?? null;
    }
    rememberScrollPosition();
  }, [
    messages,
    bucket?.loaded,
    focusMessage,
    conversationId,
    rememberScrollPosition,
  ]);

  useEffect(() => {
    function readVisible() {
      if (
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        atBottom.current
      )
        useChat.getState().markRead(conversationId);
    }
    readVisible();
    document.addEventListener("visibilitychange", readVisible);
    window.addEventListener("focus", readVisible);
    return () => {
      document.removeEventListener("visibilitychange", readVisible);
      window.removeEventListener("focus", readVisible);
    };
  }, [conversationId, messages, nearBottom, unreadCount, bucket?.hasMoreAfter]);

  async function older() {
    const viewport = timeline.current;
    const firstId = messages[0]?.id;
    if (viewport && firstId !== undefined)
      scrollSnapshot.current = {
        height: viewport.scrollHeight,
        top: viewport.scrollTop,
        firstId,
        anchor: visibleMessageAnchor(viewport),
      };
    await useChat.getState().loadOlder(conversationId);
    if (useChat.getState().buckets[conversationId]?.items[0]?.id === firstId)
      scrollSnapshot.current = null;
  }
  async function jump(id: number) {
    atBottom.current = false;
    setNearBottom(false);
    await useChat.getState().jumpTo(conversationId, id);
  }
  function scrollBottom() {
    if (bucket?.hasMoreAfter) {
      initialScrolled.current = false;
      focusedNonce.current = focusMessage?.nonce ?? null;
      void useChat.getState().loadLatest(conversationId);
    } else
      timeline.current?.scrollTo({
        top: timeline.current.scrollHeight,
        behavior: "instant",
      });
    atBottom.current = true;
    setNearBottom(true);
    rememberScrollPosition();
  }

  function retryLoad() {
    initialScrolled.current = false;
    focusedNonce.current = focusMessage?.nonce ?? null;
    void useChat.getState().loadLatest(conversationId);
  }
  function loadNewer() {
    void useChat.getState().loadNewer(conversationId);
  }
  function onScroll() {
    const viewport = timeline.current;
    if (!viewport) return;
    const previousSize = viewportSize.current;
    if (
      previousSize &&
      (previousSize.width !== viewport.clientWidth ||
        previousSize.height !== viewport.clientHeight ||
        previousSize.contentHeight !== viewport.scrollHeight)
    ) {
      preserveScrollPosition();
      return;
    }
    const bottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 100;
    atBottom.current = bottom;
    setNearBottom(bottom);
    rememberScrollPosition();
  }

  return {
    viewportRef: timeline,
    contentRef: timelineContent,
    nearBottom,
    onScroll,
    preserveScrollPosition,
    loadOlder: older,
    loadNewer,
    retryLoad,
    jumpToMessage: jump,
    jumpToLatest: scrollBottom,
  };
}

export type TimelineScrollController = ReturnType<typeof useTimelineScroll>;
