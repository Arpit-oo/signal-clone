import { expect, it } from "vitest";
import { AVATAR_COLORS, AVATAR_FOREGROUNDS } from "@/lib/avatarColors";

function luminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

it.each(Object.entries(AVATAR_COLORS))(
  "%s initials meet AA contrast even at small text sizes",
  (color, background) => {
    const foreground = AVATAR_FOREGROUNDS[color];
    expect(foreground).toMatch(/^#[0-9a-f]{6}$/i);
    const light = Math.max(luminance(background), luminance(foreground));
    const dark = Math.min(luminance(background), luminance(foreground));
    expect((light + 0.05) / (dark + 0.05)).toBeGreaterThanOrEqual(4.5);
  },
);
