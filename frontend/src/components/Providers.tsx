"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";

import { socket } from "@/lib/ws";
import { resetChat, useChat } from "@/stores/chat";
import { applyChatColor, applyTheme, usePrefs } from "@/stores/prefs";
import { useSession } from "@/stores/session";
import { conversationRoute } from "@/lib/routes";
import { disconnectCall, handleCallEvent, useCall } from "@/stores/call";
import { CallWindow } from "@/components/calls/CallWindow";
import { useAppSounds } from "@/hooks/useAppSounds";
import { sounds } from "@/lib/sounds";
import { MessageAlerts } from "@/lib/message-alerts";

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const me = useSession((s) => s.me);
  const status = useSession((s) => s.status);
  const theme = usePrefs((s) => s.theme);
  const chatColor = usePrefs((s) => s.chatColor);
  const textScale = usePrefs((s) => s.textScale);
  const restored = useRef(false);
  useAppSounds();

  useEffect(() => {
    const alerts = new MessageAlerts();
    const removeListener = socket.subscribe((event) => {
      const conversation =
        event.type === "message.new"
          ? useChat.getState().conversations[event.data.conversation_id]
          : undefined;
      handleCallEvent(event);
      if (event.type === "me.updated") useSession.getState().setMe(event.data);
      useChat.getState().handleEvent(event);
      if (
        event.type === "error" &&
        !(
          event.data.event === "call.end" &&
          event.data.detail === "This call has ended"
        )
      )
        toast.error(event.data.detail);
      const session = useSession.getState();
      if (
        event.type !== "message.new" ||
        session.status !== "authenticated" ||
        !session.me
      )
        return;
      const alert = alerts.receive(event.data, {
        userId: session.me.id,
        conversation,
        pathname: window.location.pathname,
        background: document.hidden || !document.hasFocus(),
        inCall: !!useCall.getState().call,
        prefs: usePrefs.getState(),
      });
      if (!alert) return;
      if (alert.sound) sounds.playMessage();
      if (
        alert.desktop &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        // The app owns its chime; an OS sound would create a second notification.
        try {
          const notification = new Notification(alert.title, {
            body: alert.body,
            tag: `signal-${event.data.conversation_id}`,
            silent: true,
          });
          notification.onclick = () => {
            window.focus();
            router.push(conversationRoute(event.data.conversation_id), {
              scroll: false,
            });
            notification.close();
          };
        } catch {
          /* Some mobile browsers require service-worker notifications. */
        }
      }
    });
    const removeStatus = socket.onStatus((connection) => {
      if (connection === "closed") disconnectCall();
      if (
        connection !== "open" ||
        useSession.getState().status !== "authenticated"
      )
        return;
      // Refetch after reconnect to recover events missed while the socket was down.
      const chat = useChat.getState();
      void chat.loadConversations();
      for (const [id, bucket] of Object.entries(chat.buckets)) {
        if (bucket.loaded && !bucket.hasMoreAfter)
          void chat.loadLatest(Number(id));
      }
      chat.flushOutbox();
    });
    const online = () => socket.kick();
    window.addEventListener("online", online);
    if (!restored.current) {
      restored.current = true;
      void useSession.getState().restore();
    }
    return () => {
      removeListener();
      removeStatus();
      window.removeEventListener("online", online);
    };
  }, [router]);

  useEffect(() => {
    if (status !== "authenticated" || !me) return;
    if (useChat.getState().meId !== me.id) {
      resetChat();
      void useChat.getState().init(me.id);
    }
  }, [status, me]);

  useEffect(() => {
    applyTheme(theme);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const changed = () => applyTheme(usePrefs.getState().theme);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, [theme]);

  useEffect(() => {
    applyChatColor(chatColor);
  }, [chatColor]);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--text-scale",
      String(textScale),
    );
  }, [textScale]);

  return (
    <>
      {children}
      <CallWindow />
      <Toaster position="bottom-right" richColors closeButton />
    </>
  );
}
