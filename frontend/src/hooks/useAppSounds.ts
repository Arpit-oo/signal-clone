"use client";

import { useEffect } from "react";
import { sounds } from "@/lib/sounds";
import { useCall } from "@/stores/call";
import { usePrefs } from "@/stores/prefs";
import { useSession } from "@/stores/session";

export function useAppSounds() {
  useEffect(() => {
    const sync = () => {
      const authenticated = useSession.getState().status === "authenticated";
      const prefs = usePrefs.getState();
      const call = useCall.getState().call;
      const tone =
        authenticated && prefs.callRingtone && call
          ? call.phase === "incoming"
            ? "incoming"
            : call.phase === "ringing"
              ? "outgoing"
              : null
          : null;
      sounds.setRing(tone);
      if (!authenticated || !prefs.notificationSound || call)
        sounds.stopMessages();
    };
    const unlock = () => {
      void sounds.unlock();
    };
    const keydown = (event: KeyboardEvent) => {
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key !== "Escape"
      )
        unlock();
    };
    document.addEventListener("click", unlock, true);
    document.addEventListener("keydown", keydown, true);
    const removeCall = useCall.subscribe(sync);
    const removePrefs = usePrefs.subscribe(sync);
    const removeSession = useSession.subscribe(sync);
    sync();
    return () => {
      document.removeEventListener("click", unlock, true);
      document.removeEventListener("keydown", keydown, true);
      removeCall();
      removePrefs();
      removeSession();
      sounds.dispose();
    };
  }, []);
}
