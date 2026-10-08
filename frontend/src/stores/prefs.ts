import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePref = "system" | "light" | "dark";
export type NotificationContent = "name_and_message" | "name" | "none";

/** Signal's chat colors (outgoing bubble). Gradients are [angle, start, end]. */
export const CHAT_COLORS: Record<string, string | [number, string, string]> = {
  ultramarine: "#2267f5",
  crimson: "#cf163e",
  vermilion: "#c73f0a",
  burlap: "#6f6a58",
  forest: "#3b7845",
  wintergreen: "#1d8663",
  teal: "#077d92",
  blue: "#336ba3",
  indigo: "#6058ca",
  violet: "#9932c8",
  plum: "#aa377a",
  taupe: "#8f616a",
  steel: "#71717f",
  ember: [168, "#e57c00", "#5e0000"],
  midnight: [180, "#2c2c3a", "#787891"],
  infrared: [192, "#f65560", "#442ced"],
  lagoon: [180, "#004066", "#32867d"],
  fluorescent: [192, "#ec13dd", "#1b36c6"],
  basil: [180, "#2f9373", "#077343"],
  sublime: [180, "#6281d5", "#974460"],
  sea: [180, "#498fd4", "#2c66a0"],
  tangerine: [192, "#db7133", "#911231"],
};

export const TEXT_SCALES = [0.86, 1, 1.15, 1.3] as const;

interface PrefsState {
  theme: ThemePref;
  chatColor: string;
  textScale: number;
  notificationsEnabled: boolean;
  notificationContent: NotificationContent;
  notificationSound: boolean;
  /** Signal Desktop sends on Enter; Shift+Enter inserts a newline. */
  sendWithEnter: boolean;
  spellCheck: boolean;
  leftPaneWidth: number;
  hideMenuBar: boolean;
  set: (patch: Partial<Omit<PrefsState, "set">>) => void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: "system",
      chatColor: "ultramarine",
      textScale: 1,
      notificationsEnabled: true,
      notificationContent: "name_and_message",
      notificationSound: true,
      sendWithEnter: true,
      spellCheck: true,
      leftPaneWidth: 320,
      hideMenuBar: false,
      set: (patch) => set(patch),
    }),
    { name: "signal-prefs" },
  ),
);

export function applyTheme(theme: ThemePref) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function applyChatColor(name: string) {
  const value = CHAT_COLORS[name] ?? CHAT_COLORS.ultramarine;
  const root = document.documentElement.style;
  if (typeof value === "string") {
    root.setProperty("--message-outgoing", value);
    root.setProperty("--message-outgoing-image", "none");
  } else {
    const [deg, start, end] = value;
    root.setProperty("--message-outgoing", end);
    root.setProperty("--message-outgoing-image", `linear-gradient(${deg}deg, ${start}, ${end})`);
  }
}

export function chatColorCss(name: string): string {
  const value = CHAT_COLORS[name] ?? CHAT_COLORS.ultramarine;
  return typeof value === "string" ? value : `linear-gradient(${value[0]}deg, ${value[1]}, ${value[2]})`;
}
