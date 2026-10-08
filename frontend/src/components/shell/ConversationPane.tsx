"use client";

import type { Conversation } from "@/lib/types";
import type { ConversationRouteResult } from "@/hooks/shell/useConversationRoute";
import { ChatPane } from "@/components/chat/ChatPane";
import { Button, Icon, Spinner } from "@/components/ui";

export default function ConversationPane({
  selected,
  selectedId,
  routeError,
  routeResult,
  conversationsError,
  freshAccount,
  onBack,
  onDetails,
  onRetry,
  onNewChat,
}: {
  selected: Conversation | null | undefined;
  selectedId: number | null;
  routeError: string;
  routeResult: ConversationRouteResult | null;
  conversationsError: string | null;
  freshAccount: boolean;
  onBack: () => void;
  onDetails: () => void;
  onRetry: () => void;
  onNewChat: () => void;
}) {
  return (
    <section className="app-conversation" aria-label="Messages">
      {selected ? (
        <ChatPane
          key={selected.id}
          conversationId={selected.id}
          onBack={onBack}
          onDetails={onDetails}
        />
      ) : selectedId ? (
        <div className="conversation-route-state" role="status">
          {routeError || conversationsError ? (
            <>
              <Icon name="chat" size={40} />
              <h2>
                {routeResult?.id === selectedId && routeResult.inaccessible
                  ? "Conversation unavailable"
                  : "Couldn’t open conversation"}
              </h2>
              <p>{routeError || conversationsError}</p>
              <div className="form-actions">
                <Button variant="secondary" onClick={onBack}>
                  Back to chats
                </Button>
                {!routeResult?.inaccessible && (
                  <Button onClick={onRetry}>Retry</Button>
                )}
              </div>
            </>
          ) : (
            <>
              <Spinner label="Opening conversation" />
              <p>Opening conversation…</p>
              <Button variant="secondary" onClick={onBack}>
                Back to chats
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="welcome-pane">
          <Icon name="chat" size={58} />
          <h2>{freshAccount ? "Start a conversation" : "Select a chat"}</h2>
          <p>
            {freshAccount
              ? "Find someone using their phone number or username."
              : "Choose a conversation from your chat list."}
          </p>
          <Button onClick={() => onNewChat()}>
            <Icon name="compose" size={18} />
            New conversation
          </Button>
        </div>
      )}
    </section>
  );
}
