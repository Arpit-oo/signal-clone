"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Toaster, toast } from "sonner";

import { socket } from "@/lib/ws";
import { resetChat, useChat } from "@/stores/chat";
import { applyChatColor, applyTheme, usePrefs } from "@/stores/prefs";
import { useSession } from "@/stores/session";

export function Providers({ children }: { children: ReactNode }) {
  const me = useSession((s) => s.me);
  const status = useSession((s) => s.status);
  const theme = usePrefs((s) => s.theme);
  const chatColor = usePrefs((s) => s.chatColor);
  const textScale = usePrefs((s) => s.textScale);
  const restored = useRef(false);

  useEffect(() => {
    const removeListener = socket.subscribe((event) => {
      if (event.type === "me.updated") useSession.getState().setMe(event.data);
      useChat.getState().handleEvent(event);
      if (event.type === "error") toast.error(event.data.detail);
      if (event.type !== "message.new" || event.data.type !== "text" ||
          event.data.sender_id === useSession.getState().me?.id || !document.hidden) return;
      const prefs = usePrefs.getState();
      const conversation = useChat.getState().conversations[event.data.conversation_id];
      if (!prefs.notificationsEnabled || (conversation?.muted_until && new Date(conversation.muted_until).getTime() > Date.now())) return;
      if ("Notification" in window && Notification.permission === "granted") {
        const title = prefs.notificationContent === "none" ? "New message" : conversation?.name ?? "Signal";
        const body = prefs.notificationContent === "name_and_message" ? event.data.body || "Attachment" : "";
        const notification = new Notification(title, { body, tag: `signal-${event.data.conversation_id}`, silent: !prefs.notificationSound });
        notification.onclick = () => { window.focus(); notification.close(); };
      }
    });
    const removeStatus = socket.onStatus((connection) => {
      if (connection !== "open" || useSession.getState().status !== "authenticated") return;
      // Refetch after reconnect to recover events missed while the socket was down.
      const chat = useChat.getState();
      void chat.loadConversations();
      for (const [id, bucket] of Object.entries(chat.buckets)) {
        if (bucket.loaded && !bucket.hasMoreAfter) void chat.loadLatest(Number(id));
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
  }, []);

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

  useEffect(() => { applyChatColor(chatColor); }, [chatColor]);
  useEffect(() => { document.documentElement.style.setProperty("--text-scale", String(textScale)); }, [textScale]);

  return <>{children}<Toaster position="bottom-right" richColors closeButton /></>;
}
