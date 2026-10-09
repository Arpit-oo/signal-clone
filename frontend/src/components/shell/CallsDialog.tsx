"use client";

import { useState } from "react";
import { Avatar, IconButton, Modal } from "@/components/ui";
import { useChat } from "@/stores/chat";
import { useCall } from "@/stores/call";

export default function CallsDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const conversations = useChat((s) => s.conversations);
  const presence = useChat((s) => s.presence);
  const contacts = Object.values(conversations).filter((c) => c.type === "direct" && c.is_member && !c.peer?.is_blocked && c.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <Modal title="Calls" onClose={onClose}>
      <div className="ui-modal-body">
        <p>Start a voice or video call with someone you chat with.</p>
        <label className="ui-field">Search people<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name" /></label>
        {!contacts.length && <p className="muted-text">No matching chats. Start a conversation first.</p>}
        {contacts.map((c) => <div className="calls-contact" key={c.id}>
          <Avatar name={c.name} color={c.avatar_color} url={c.avatar_url} size={40} />
          <span><strong>{c.name}</strong><small>{(presence[c.peer!.id]?.online ?? c.peer!.is_online) ? "Online" : "Offline"}</small></span>
          <IconButton name="phone" label={`Voice call ${c.name}`} onClick={() => { onClose(); void useCall.getState().start(c, "voice"); }} />
          <IconButton name="video" label={`Video call ${c.name}`} onClick={() => { onClose(); void useCall.getState().start(c, "video"); }} />
        </div>)}
      </div>
    </Modal>
  );
}
