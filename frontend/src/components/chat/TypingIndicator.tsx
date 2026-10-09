import type { User } from "@/lib/types";
import { displayName } from "@/stores/chat";

export function TypingIndicator({
  typing,
  users,
  groupChat,
}: {
  typing: number[];
  users: Record<number, User>;
  groupChat: boolean;
}) {
  const names = typing.map((id) => displayName(users[id])).join(", ");
  const description = `${names} ${typing.length === 1 ? "is" : "are"} typing…`;
  return (
    <div
      className={`chat-typing-row ${groupChat ? "chat-group-typing" : ""}`}
      role="status"
      aria-label={description}
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="chat-typing-bubble" aria-hidden="true">
        <span className="typing-dot" />
        <span className="typing-dot" style={{ animationDelay: "160ms" }} />
        <span className="typing-dot" style={{ animationDelay: "320ms" }} />
      </div>
      <small className="chat-typing-description">{description}</small>
    </div>
  );
}
