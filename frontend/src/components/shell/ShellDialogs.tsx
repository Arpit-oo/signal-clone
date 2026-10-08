"use client";

import NewChat from "@/components/NewChat";
import Settings from "@/components/Settings";
import CallsDialog from "./CallsDialog";

export default function ShellDialogs({
  newChat,
  settings,
  comingSoon,
  onNewChatClose,
  onSettingsClose,
  onCallsClose,
  onCreated,
}: {
  newChat: boolean;
  settings: boolean;
  comingSoon: "Calls" | null;
  onNewChatClose: () => void;
  onSettingsClose: () => void;
  onCallsClose: () => void;
  onCreated: (id: number) => void;
}) {
  return (
    <>
      {newChat && (
        <NewChat onClose={() => onNewChatClose()} onCreated={onCreated} />
      )}{" "}
      {settings && <Settings onClose={() => onSettingsClose()} />}
      {comingSoon && <CallsDialog onClose={onCallsClose} />}
    </>
  );
}
