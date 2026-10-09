import { conversationRoute } from "@/lib/routes";
import type { Conversation, Message } from "@/lib/types";
import type { NotificationContent } from "@/stores/prefs";

interface AlertContext {
  userId: number;
  conversation?: Conversation;
  pathname: string;
  background: boolean;
  inCall: boolean;
  prefs: {
    notificationsEnabled: boolean;
    notificationSound: boolean;
    notificationContent: NotificationContent;
  };
}

/** Decide once per live incoming message; history loads never pass through here. */
export class MessageAlerts {
  private userId: number | null = null;
  private seen = new Set<number>();

  receive(message: Message, context: AlertContext) {
    if (this.userId !== context.userId) {
      this.userId = context.userId;
      this.seen.clear();
    }
    if (this.seen.has(message.id)) return null;
    this.seen.add(message.id);
    if (this.seen.size > 5000)
      this.seen.delete(this.seen.values().next().value!);
    const conversation = context.conversation;
    if (
      message.type !== "text" ||
      !message.sender_id ||
      message.sender_id === context.userId ||
      message.is_deleted ||
      (message.expires_at &&
        new Date(message.expires_at).getTime() <= Date.now()) ||
      (conversation?.last_read_message_id &&
        message.id <= conversation.last_read_message_id) ||
      (conversation?.muted_until &&
        new Date(conversation.muted_until).getTime() > Date.now()) ||
      conversation?.peer?.is_blocked
    )
      return null;
    const reading =
      !context.background &&
      context.pathname === conversationRoute(message.conversation_id);
    if (reading) return null;
    return {
      sound: context.prefs.notificationSound && !context.inCall,
      desktop: context.background && context.prefs.notificationsEnabled,
      title:
        context.prefs.notificationContent === "none"
          ? "New message"
          : (conversation?.name ?? "Signal"),
      body:
        context.prefs.notificationContent === "name_and_message"
          ? message.body || "Attachment"
          : "",
    };
  }
}
