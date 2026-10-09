"use client";

import { useEffect, useState } from "react";
import { api, fileUrl } from "@/lib/api";
import type { Attachment } from "@/lib/types";
import { ErrorText, Icon, Modal, Spinner, errorMessage } from "@/components/ui";

export function SharedMediaDialog({
  conversationId,
  onClose,
}: {
  conversationId: number;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const found: Attachment[] = [];
        let before: number | undefined;
        for (;;) {
          const page = await api.conversations.messages(conversationId, {
            before,
            limit: 200,
          });
          if (!active) return;
          found.push(...page.items.flatMap((message) => message.attachments));
          if (!page.has_more_before || !page.items.length) break;
          before = page.items[0].id;
        }
        if (active) setItems(found);
      } catch (e) {
        if (active) setError(errorMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [conversationId]);
  return (
    <Modal title="All media" onClose={onClose}>
      <div className="ui-modal-body">
        {loading ? (
          <Spinner label="Loading shared media" />
        ) : !items.length && !error ? (
          <p>
            No shared media yet. Images, files and voice notes will appear here.
          </p>
        ) : (
          <div className="shared-media-list">
            {items.map((item) => (
              <a
                key={item.id}
                href={fileUrl(item.url)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name={item.kind === "image" ? "image" : "file"} />
                <span>
                  {item.file_name}
                  <small>{Math.round(item.size_bytes / 1024)} KB</small>
                </span>
                <Icon name="download" size={18} />
              </a>
            ))}
          </div>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    </Modal>
  );
}
