"use client";

import { useEffect, useRef, useState } from "react";
import type { Conversation } from "@/lib/types";
import { useChat } from "@/stores/chat";

export function useConversationMenu() {
  const conversations = useChat((state) => state.conversations);
  const [savedConversation, setConversation] = useState<Conversation | null>(
    null,
  );
  const conversation = savedConversation
    ? (conversations[savedConversation.id] ?? savedConversation)
    : null;
  const id = conversation?.id;
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!id) return;
    const frame = requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus(),
    );
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setConversation(null);
    }
    document.addEventListener("keydown", escape);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", escape);
      if (trigger.current?.isConnected) trigger.current.focus();
    };
  }, [id]);
  function open(next: Conversation, anchor: HTMLElement) {
    const bounds = anchor.getBoundingClientRect();
    trigger.current = anchor;
    setPosition({
      left: Math.max(8, Math.min(bounds.right - 238, window.innerWidth - 254)),
      top:
        bounds.bottom + 288 < window.innerHeight
          ? bounds.bottom + 6
          : Math.max(8, bounds.top - 288),
    });
    setConversation(next);
  }
  return {
    conversation,
    position,
    ref,
    open,
    close: () => setConversation(null),
  };
}
