"use client";

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
    messageDialog: dialog,
    closeImage,
    closeMessage,
  } = controller;
  return (
    <>
      {image && <ImageDialog attachment={image} onClose={closeImage} />}
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
