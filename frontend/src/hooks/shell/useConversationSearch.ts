"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { SearchResults } from "@/lib/types";
import { useChat } from "@/stores/chat";
import { errorMessage } from "@/components/ui";

export function useConversationSearch() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{
    query: string;
    results: SearchResults | null;
    error: string;
  }>({ query: "", results: null, error: "" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!query.trim()) return;
    let active = true;
    const timer = setTimeout(
      () =>
        api
          .search(query.trim())
          .then((results) => {
            if (active) {
              useChat.getState().rememberUsers(results.contacts);
              setSearch({ query, results, error: "" });
            }
          })
          .catch((cause) => {
            if (active)
              setSearch({ query, results: null, error: errorMessage(cause) });
          }),
      250,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, attempt]);

  function retry() {
    setSearch({ query: "", results: null, error: "" });
    setAttempt((value) => value + 1);
  }
  return {
    query,
    setQuery,
    results: search.results,
    pending: search.query !== query,
    error: search.query === query ? search.error : "",
    retry,
  };
}
