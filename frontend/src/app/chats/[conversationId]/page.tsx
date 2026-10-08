import { notFound } from "next/navigation";
import ChatsScreen from "@/components/ChatsScreen";

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ details?: string }>;
}) {
  const { conversationId } = await params;
  const id = Number(conversationId);
  if (!/^[1-9]\d*$/.test(conversationId) || !Number.isSafeInteger(id)) {
    notFound();
  }
  const { details } = await searchParams;
  return (
    <ChatsScreen initialConversationId={id} initialDetails={details === "1"} />
  );
}
