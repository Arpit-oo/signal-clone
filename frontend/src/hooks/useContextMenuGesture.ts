"use client";

import { useEffect, useRef, type HTMLAttributes } from "react";

/** Keep scrolling and ordinary taps intact while supporting native-style menus. */
export function useContextMenuGesture(
  onOpen: (anchor: HTMLElement) => void,
  disabled = false,
): HTMLAttributes<HTMLElement> {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const releaseGuard = useRef<(() => void) | null>(null);
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      releaseGuard.current?.();
    },
    [],
  );

  function guardRelease() {
    releaseGuard.current?.();
    function cleanup() {
      document.removeEventListener("mousedown", suppress, true);
      document.removeEventListener("click", suppress, true);
      document.removeEventListener("pointerdown", cleanup, true);
      document.removeEventListener("pointercancel", cleanup, true);
      releaseGuard.current = null;
    }
    function suppress(event: MouseEvent) {
      if (event.detail === 0) {
        cleanup();
        return;
      }
      if (event.button !== 0) return;
      // Touch release can target the menu's new scrim rather than this element.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === "click") cleanup();
    }
    document.addEventListener("mousedown", suppress, true);
    document.addEventListener("click", suppress, true);
    document.addEventListener("pointerdown", cleanup, true);
    document.addEventListener("pointercancel", cleanup, true);
    releaseGuard.current = cleanup;
  }

  function isInteractiveChild(target: EventTarget, anchor: HTMLElement) {
    const control = (target as HTMLElement).closest(
      "a, button, input, textarea, select, audio, video",
    );
    return (
      control && control !== anchor && !control.matches(".chat-image-button")
    );
  }

  return {
    onContextMenu(event) {
      if (disabled || isInteractiveChild(event.target, event.currentTarget))
        return;
      cancel();
      event.preventDefault();
      onOpen(event.currentTarget);
    },
    onKeyDown(event) {
      if (
        disabled ||
        (event.key !== "ContextMenu" &&
          !(event.shiftKey && event.key === "F10"))
      )
        return;
      event.preventDefault();
      onOpen(event.currentTarget);
    },
    onPointerDown(event) {
      cancel();
      if (
        disabled ||
        event.pointerType === "mouse" ||
        !event.isPrimary ||
        event.button !== 0 ||
        isInteractiveChild(event.target, event.currentTarget)
      )
        return;
      const anchor = event.currentTarget;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        if (!anchor.isConnected) return;
        // Opening the menu must not also select the chat or open its image.
        guardRelease();
        onOpen(anchor);
      }, 500);
    },
    onPointerMove(event) {
      if (
        Math.hypot(
          event.clientX - origin.current.x,
          event.clientY - origin.current.y,
        ) > 10
      )
        cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
  };
}
