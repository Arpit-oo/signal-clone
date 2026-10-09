import type { CSSProperties } from "react";
import { fileUrl } from "./api";

export const WALLPAPERS: Record<string, { name: string; background: string }> =
  {
    blue: {
      name: "Sky",
      background: "linear-gradient(145deg, #d7e8fb, #c5d5ec)",
    },
    mint: {
      name: "Mint",
      background: "linear-gradient(145deg, #d8e9df, #b7d8d3)",
    },
    lavender: {
      name: "Lavender",
      background: "linear-gradient(145deg, #e7e1f0, #c7c7e4)",
    },
    sand: {
      name: "Sand",
      background: "linear-gradient(145deg, #f0e6d4, #ddcdbb)",
    },
    rose: {
      name: "Rose",
      background: "linear-gradient(145deg, #f1dfe3, #ddc6d8)",
    },
    night: {
      name: "Night",
      background: "linear-gradient(145deg, #243148, #121c2e)",
    },
  };

export function wallpaperStyle(
  value: string | null | undefined,
  conversationId: number,
): CSSProperties {
  if (!value) return {};
  if (WALLPAPERS[value]) return { background: WALLPAPERS[value].background };
  if (value.startsWith("wallpapers/")) {
    const url = fileUrl(
      `/api/conversations/${conversationId}/wallpaper?v=${encodeURIComponent(value)}`,
    );
    return {
      backgroundImage: `url("${url}")`,
      backgroundPosition: "center",
      backgroundSize: "cover",
    };
  }
  return {};
}
