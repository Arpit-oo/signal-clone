"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { Button, ErrorText, Icon, Spinner } from "@/components/ui";
import { useSession } from "@/stores/session";

export default function Home() {
  const status = useSession((s) => s.status);
  const me = useSession((s) => s.me);
  const error = useSession((s) => s.error);
  const router = useRouter();
  useEffect(() => {
    if (
      status === "anonymous" ||
      (status === "authenticated" && !me?.display_name)
    )
      router.replace("/login");
  }, [status, me?.display_name, router]);
  if (status === "unavailable")
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
  if (status !== "authenticated" || !me?.display_name)
    return (
      <main className="app-loading">
        <span className="signal-mark">
          <Icon name="chat" size={30} />
        </span>
        <Spinner />
        <p>Opening your conversations…</p>
      </main>
    );
  return <AppShell />;
}
