"use client";

import NewChat from "@/components/NewChat";
import Settings from "@/components/Settings";
import { Button, Modal } from "@/components/ui";

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
      {comingSoon && (
        <Modal title={comingSoon} onClose={() => onCallsClose()}>
          <div className="ui-modal-body">
            <p>{comingSoon} are coming soon.</p>
            <p className="subtle-note">
              Voice and video calling will be available in a future release.
            </p>
            <div className="form-actions">
              <Button onClick={() => onCallsClose()}>Got it</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
