"use client";

import { Modal } from "@/components/ui";
import {
  DeleteDialog,
  ForwardDialog,
  ImageDialog,
  InfoDialog,
} from "./MessageDialogs";
import type { ConversationDialogController } from "./useConversationActions";

export function ConversationDialogs({
  controller,
}: {
  controller: ConversationDialogController;
}) {
  const {
    image,
    callType,
    messageDialog: dialog,
    closeImage,
    closeCall,
    closeMessage,
  } = controller;
  return (
    <>
      {image && <ImageDialog attachment={image} onClose={closeImage} />}
      {callType && (
        <Modal title="Coming Soon" onClose={closeCall}>
          <div className="chat-dialog-content chat-call-dialog">
            <h3>{callType === "video" ? "Video calls" : "Voice calls"}</h3>
            <p>
              {callType === "video" ? "Video" : "Voice"} calling is not
              available yet. You can send messages and voice notes in this
              conversation.
            </p>
            <div className="chat-dialog-actions">
              <button
                className="chat-button chat-primary-button"
                onClick={closeCall}
              >
                Got it
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog?.type === "delete" && (
        <DeleteDialog message={dialog.message} onClose={closeMessage} />
      )}
      {dialog?.type === "forward" && (
        <ForwardDialog message={dialog.message} onClose={closeMessage} />
      )}
      {dialog?.type === "info" && (
        <InfoDialog message={dialog.message} onClose={closeMessage} />
      )}
    </>
  );
}
