import ChatsScreen from "@/components/ChatsScreen";

export default async function ChatsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string | string[] }>;
}) {
  const { filter } = await searchParams;
  return (
    <ChatsScreen initialFilter={filter === "archive" ? "archive" : "all"} />
  );
}
