"use client";

import { Button, Modal } from "@/components/ui";

export default function CallsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Calls" onClose={onClose}>
      <div className="ui-modal-body">
        <p>Calls are coming soon.</p>
        <p className="subtle-note">
          Voice and video calling will be available in a future release.
        </p>
        <div className="form-actions">
          <Button onClick={onClose}>Got it</Button>
        </div>
      </div>
    </Modal>
  );
}
