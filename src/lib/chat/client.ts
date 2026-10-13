import { parseApiError } from "@/lib/api";
import type { ConversationDocument, ConversationSummary } from "@/types";

// Browser-side calls to the chat API. Each rejects with an Error whose
// message is safe to show.

export async function createConversation(documentIds: string[]): Promise<ConversationSummary> {
  const response = await fetch("/api/chat/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documentIds }),
  });
  if (response.status !== 201) {
    throw new Error(parseApiError(await response.text(), "Couldn't start the chat. Please try again."));
  }
  const body = (await response.json()) as { conversation: ConversationSummary };
  return body.conversation;
}

/** Renames a conversation and/or replaces its documents. Resolves with both as they now are. */
export async function updateConversation(
  conversationId: string,
  changes: { title?: string; documentIds?: string[] },
): Promise<{ conversation: ConversationSummary; documents: ConversationDocument[] }> {
  const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(changes),
  });
  if (!response.ok) {
    throw new Error(parseApiError(await response.text(), "Couldn't save the changes. Please try again."));
  }
  return (await response.json()) as { conversation: ConversationSummary; documents: ConversationDocument[] };
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
    method: "DELETE",
  });
  // 404 means it's already gone, which is what the caller wanted
  if (!response.ok && response.status !== 404) {
    throw new Error(parseApiError(await response.text(), "Couldn't delete the chat. Please try again."));
  }
}
