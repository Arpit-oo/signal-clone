import { create } from "zustand";

import { api, ApiError, getToken, setToken, setUnauthorizedHandler } from "@/lib/api";
import type { Me } from "@/lib/types";
import { socket } from "@/lib/ws";
import { routes } from "@/lib/routes";

type Status = "loading" | "anonymous" | "authenticated" | "unavailable";

interface SessionState {
  status: Status;
  me: Me | null;
  error: string | null;
  restore: () => Promise<void>;
  signIn: (token: string, me: Me) => void;
  setMe: (me: Me) => void;
  signOut: (destination?: "login" | "signup") => void;
}

export const useSession = create<SessionState>()((set, get) => ({
  status: "loading",
  me: null,
  error: null,

  restore: async () => {
    if (get().status === "authenticated") return;
    set({ status: "loading", error: null });
    const token = getToken();
    if (!token) {
      set({ status: "anonymous" });
      return;
    }
    try {
      const me = await api.me.get();
      set({ me, status: "authenticated", error: null });
      socket.connect(token);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status === 0 || err.status >= 500) {
        set({ status: "unavailable", error: err instanceof Error ? err.message : "Server unavailable" });
        return;
      }
      setToken(null);
      set({ status: "anonymous", me: null });
    }
  },

  signIn: (token, me) => {
    setToken(token);
    set({ me, status: "authenticated", error: null });
    socket.connect(token);
  },

  setMe: (me) => set({ me }),

  signOut: (destination = "login") => {
    socket.disconnect();
    setToken(null);
    set({ me: null, status: "anonymous" });
    // Reset in-memory chat state by reloading; it also clears any cached media URLs.
    window.location.replace(routes[destination]);
  },
}));

setUnauthorizedHandler(() => {
  if (useSession.getState().status === "authenticated") useSession.getState().signOut();
});
