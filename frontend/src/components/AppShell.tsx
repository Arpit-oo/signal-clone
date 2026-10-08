"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { Conversation } from "@/lib/types";
import { useChat } from "@/stores/chat";
import { usePrefs } from "@/stores/prefs";
import { useNow } from "@/components/ui";
import ConversationDetails from "@/components/ConversationDetails";
import ConversationList from "@/components/shell/ConversationList";
import ConversationMenu from "@/components/shell/ConversationMenu";
import ConversationPane from "@/components/shell/ConversationPane";
import ConversationSearchResults from "@/components/shell/ConversationSearchResults";
import ConversationSidebar from "@/components/shell/ConversationSidebar";
import NavigationRail from "@/components/shell/NavigationRail";
import ShellDialogs from "@/components/shell/ShellDialogs";
import {
  useConversationActions,
  type ConversationSettingsPatch,
} from "@/hooks/shell/useConversationActions";
import {
  useConversationList,
  type ConversationFilter,
} from "@/hooks/shell/useConversationList";
import { useConversationMenu } from "@/hooks/shell/useConversationMenu";
import { useConversationRoute } from "@/hooks/shell/useConversationRoute";
import { useConversationSearch } from "@/hooks/shell/useConversationSearch";

export default function AppShell({
  initialConversationId,
  initialDetails = false,
}: { initialConversationId?: number; initialDetails?: boolean } = {}) {
  const router = useRouter();
  const now = useNow();
  const conversations = useChat((state) => state.conversations);
  const paneWidth = usePrefs((state) => state.leftPaneWidth);
  const [settings, setSettings] = useState(false);
  const [newChat, setNewChat] = useState(false);
  const [comingSoon, setComingSoon] = useState<"Calls" | null>(null);
  const [filter, setFilter] = useState<ConversationFilter>(() =>
    initialConversationId &&
    Number.isSafeInteger(initialConversationId) &&
    initialConversationId > 0 &&
    conversations[initialConversationId]?.is_archived
      ? "archive"
      : "all",
  );
  const route = useConversationRoute(initialConversationId, setFilter);
  const search = useConversationSearch();
  const menu = useConversationMenu();
  const actions = useConversationActions({
    selectedId: route.selectedId,
    onSelectConversation: selectConversation,
    onBackToChats: backToChats,
  });
  const { unreadCount, freshAccount } = useConversationList(filter);
  const details = initialDetails;

  function select(id: number) {
    if (!Number.isSafeInteger(id) || id <= 0) return;
    search.setQuery("");
    menu.close();
    actions.clearFeedback();
    router.push(`/chats/${id}`, { scroll: false });
  }
  function selectConversation(conversation: Conversation) {
    setFilter(conversation.is_archived ? "archive" : "all");
    select(conversation.id);
  }
  function backToChats() {
    menu.close();
    actions.clearError();
    router.push("/chats", { scroll: false });
  }
  function showDetails(open: boolean) {
    if (!route.selectedId) return;
    router.replace(`/chats/${route.selectedId}${open ? "?details=1" : ""}`, {
      scroll: false,
    });
  }
  function chooseFilter(next: ConversationFilter) {
    setFilter(next);
    search.setQuery("");
  }
  function openMenu(conversation: Conversation, anchor: HTMLElement) {
    menu.open(conversation, anchor);
    actions.clearError();
  }
  async function updateMenu(patch: ConversationSettingsPatch) {
    if (
      menu.conversation &&
      (await actions.updateConversation(menu.conversation, patch))
    )
      menu.close();
  }
  async function toggleMenuRead() {
    if (menu.conversation && (await actions.toggleRead(menu.conversation)))
      menu.close();
  }
  function openMenuDetails(id: number) {
    menu.close();
    search.setQuery("");
    router.push(`/chats/${id}?details=1`, { scroll: false });
  }

  return (
    <main
      className={`app-shell ${route.selectedId ? "has-conversation" : ""} ${details ? "has-details" : ""}`}
      style={
        {
          "--sidebar-width": `${Math.min(440, Math.max(300, paneWidth + 24))}px`,
        } as CSSProperties
      }
    >
      <NavigationRail
        filter={filter}
        unreadCount={unreadCount}
        onFilterChange={chooseFilter}
        onSettings={() => setSettings(true)}
        onCalls={() => setComingSoon("Calls")}
      />
      <ConversationSidebar
        filter={filter}
        query={search.query}
        onQueryChange={search.setQuery}
        onFilterChange={chooseFilter}
        onSettings={() => setSettings(true)}
        onNewChat={() => setNewChat(true)}
        statusMessage={actions.statusMessage}
      >
        <ConversationList
          filter={filter}
          selectedId={route.selectedId}
          query={search.query}
          onSelect={select}
          onMenu={openMenu}
          onPin={(conversation) => void actions.togglePin(conversation)}
          pinningId={actions.pinningId}
          busy={actions.busy}
          actionError={actions.error}
          onNewChat={() => setNewChat(true)}
          onCopyAddress={() => void actions.copyAddress()}
        >
          <ConversationSearchResults
            query={search.query}
            pending={search.pending}
            results={search.results}
            error={search.error}
            busy={actions.busy}
            onRetry={search.retry}
            onConversation={(conversation) => {
              useChat.getState().upsertConversation(conversation);
              selectConversation(conversation);
            }}
            onPerson={(user) => {
              if (!actions.busy) void actions.openPerson(user);
            }}
            onMessage={(message) => {
              if (!actions.busy) void actions.openMessage(message);
            }}
          />
        </ConversationList>
      </ConversationSidebar>
      <ConversationPane
        selected={route.selected}
        selectedId={route.selectedId}
        routeError={route.routeError}
        routeResult={route.routeResult}
        conversationsError={route.conversationsError}
        freshAccount={freshAccount}
        onBack={backToChats}
        onDetails={() => showDetails(!details)}
        onRetry={route.retry}
        onNewChat={() => setNewChat(true)}
      />
      {details && route.selected && (
        <ConversationDetails
          key={route.selected.id}
          conversationId={route.selected.id}
          onClose={() => showDetails(false)}
          onRemoved={backToChats}
        />
      )}{" "}
      <ShellDialogs
        newChat={newChat}
        settings={settings}
        comingSoon={comingSoon}
        onNewChatClose={() => setNewChat(false)}
        onSettingsClose={() => setSettings(false)}
        onCallsClose={() => setComingSoon(null)}
        onCreated={(id) => {
          const created = useChat.getState().conversations[id];
          setFilter(created?.is_archived ? "archive" : "all");
          select(id);
          setNewChat(false);
        }}
      />
      {menu.conversation && (
        <ConversationMenu
          menu={menu.conversation}
          position={menu.position}
          menuRef={menu.ref}
          busy={actions.busy}
          actionError={actions.error}
          now={now}
          onClose={menu.close}
          onUpdate={(patch) => void updateMenu(patch)}
          onToggleRead={() => void toggleMenuRead()}
          onDetails={openMenuDetails}
        />
      )}
    </main>
  );
}
