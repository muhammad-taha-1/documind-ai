"use client";

import { createContext, type ReactNode, use, useCallback, useMemo, useState } from "react";
import type { ConversationSummary } from "@/types";

interface ConversationsContextValue {
  /** Most recently active first */
  conversations: ConversationSummary[];
  addConversation: (conversation: ConversationSummary) => void;
  removeConversation: (conversationId: string) => void;
}

const ConversationsContext = createContext<ConversationsContextValue | null>(null);

/**
 * The sidebar's conversation list. The server renders the initial list; after
 * that, pages update it here when they create or delete a conversation. (The
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

  const addConversation = useCallback((conversation: ConversationSummary) => {
    setConversations((current) => [
      conversation,
      ...current.filter((existing) => existing.id !== conversation.id),
    ]);
  }, []);

  const removeConversation = useCallback((conversationId: string) => {
    setConversations((current) => current.filter((existing) => existing.id !== conversationId));
  }, []);

  const value = useMemo(
    () => ({ conversations, addConversation, removeConversation }),
    [conversations, addConversation, removeConversation],
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
