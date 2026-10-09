"use client";

import { createContext, type ReactNode, use, useCallback, useMemo, useState } from "react";
import type { ConversationSummary } from "@/types";

interface ConversationsContextValue {
  /** Most recently active first */
  conversations: ConversationSummary[];
  /** Adds a conversation, or replaces it if it exists, and moves it to the top */
  upsertConversation: (conversation: ConversationSummary) => void;
  removeConversation: (conversationId: string) => void;
}

const ConversationsContext = createContext<ConversationsContextValue | null>(null);

/**
 * The sidebar's conversation list. The server renders the initial list; after
 * that, pages update it here when they create, change or delete a conversation. (The
 * dashboard layout doesn't re-render on navigation, so it can't refresh the
 * list itself.)
 */
export function ConversationsProvider({
  initialConversations,
  children,
}: {
  initialConversations: ConversationSummary[];
  children: ReactNode;
}) {
  const [conversations, setConversations] = useState(initialConversations);

  const upsertConversation = useCallback((conversation: ConversationSummary) => {
    setConversations((current) => [
      conversation,
      ...current.filter((existing) => existing.id !== conversation.id),
    ]);
  }, []);

  const removeConversation = useCallback((conversationId: string) => {
    setConversations((current) => current.filter((existing) => existing.id !== conversationId));
  }, []);

  const value = useMemo(
    () => ({ conversations, upsertConversation, removeConversation }),
    [conversations, upsertConversation, removeConversation],
  );
  return <ConversationsContext value={value}>{children}</ConversationsContext>;
}

export function useConversations(): ConversationsContextValue {
  const value = use(ConversationsContext);
  if (!value) {
    throw new Error("useConversations must be used inside <ConversationsProvider>");
  }
  return value;
}
