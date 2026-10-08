"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { Button, ErrorText, Icon, Spinner } from "@/components/ui";
import { authRoute, conversationRoute, routes } from "@/lib/routes";
import { useSession } from "@/stores/session";

export default function ChatsScreen({
  initialConversationId,
  initialDetails = false,
}: {
  initialConversationId?: number;
  initialDetails?: boolean;
}) {
  const status = useSession((s) => s.status);
  const me = useSession((s) => s.me);
  const error = useSession((s) => s.error);
  const router = useRouter();
  const destination = initialConversationId
    ? `${conversationRoute(initialConversationId)}${initialDetails ? "?details=1" : ""}`
    : routes.chats;
  useEffect(() => {
    if (status === "anonymous") {
      router.replace(authRoute("login", destination));
    } else if (status === "authenticated" && !me?.display_name) {
      router.replace(authRoute("signup", destination));
    }
  }, [status, me?.display_name, router, destination]);
  if (status === "unavailable") {
    return (
      <main className="app-loading">
        <span className="signal-mark">
          <Icon name="chat" size={30} />
        </span>
        <h2>Let’s reconnect</h2>
        <ErrorText>{error}</ErrorText>
        <Button onClick={() => void useSession.getState().restore()}>
          Try again
        </Button>
      </main>
    );
  }
  if (status !== "authenticated" || !me?.display_name) {
    return (
      <main className="app-loading">
        <span className="signal-mark">
          <Icon name="chat" size={30} />
        </span>
        <Spinner />
        <p>Opening your conversations…</p>
      </main>
    );
  }
  return (
    <AppShell
      initialConversationId={initialConversationId}
      initialDetails={initialDetails}
    />
  );
}
