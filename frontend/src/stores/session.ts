import { create } from "zustand";

import { api, getToken, setToken, setUnauthorizedHandler } from "@/lib/api";
import type { Me } from "@/lib/types";
import { socket } from "@/lib/ws";

type Status = "loading" | "anonymous" | "authenticated";

interface SessionState {
  status: Status;
  me: Me | null;
  restore: () => Promise<void>;
  signIn: (token: string, me: Me) => void;
  setMe: (me: Me) => void;
  signOut: () => void;
}

export const useSession = create<SessionState>()((set, get) => ({
  status: "loading",
  me: null,

  restore: async () => {
    if (get().status === "authenticated") return;
    const token = getToken();
    if (!token) {
      set({ status: "anonymous" });
      return;
    }
    try {
      const me = await api.me.get();
      set({ me, status: "authenticated" });
      socket.connect(token);
    } catch {
      setToken(null);
      set({ status: "anonymous", me: null });
    }
  },

  signIn: (token, me) => {
    setToken(token);
    set({ me, status: "authenticated" });
    socket.connect(token);
  },

  setMe: (me) => set({ me }),

  signOut: () => {
    socket.disconnect();
    setToken(null);
    set({ me: null, status: "anonymous" });
    // Reset in-memory chat state by reloading; it also clears any cached media URLs.
    window.location.assign("/login");
  },
}));

setUnauthorizedHandler(() => {
  if (useSession.getState().status === "authenticated") useSession.getState().signOut();
});
