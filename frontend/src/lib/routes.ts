export const routes = {
  home: "/",
  download: "/download",
  login: "/login",
  signup: "/signup",
  chats: "/chats",
  stories: "/stories",
} as const;

export function conversationRoute(id: number): string {
  return `${routes.chats}/${id}`;
}

/** Only return to known product routes after signing in. */
export function safeReturnPath(value?: string | string[]): string {
  if (
    typeof value === "string" &&
    (value === routes.chats ||
      value === routes.stories ||
      /^\/chats\/[1-9]\d*(?:\?details=1)?$/.test(value))
  ) {
    return value;
  }
  return routes.chats;
}

export function authRoute(
  mode: "login" | "signup",
  next: string = routes.chats,
): string {
  const path = routes[mode];
  const destination = safeReturnPath(next);
  return destination === routes.chats
    ? path
    : `${path}?next=${encodeURIComponent(destination)}`;
}
