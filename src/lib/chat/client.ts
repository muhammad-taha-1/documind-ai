import { parseApiError } from "@/lib/api";
import type { ConversationSummary } from "@/types";

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

export async function deleteConversation(conversationId: string): Promise<void> {
  const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
    method: "DELETE",
  });
  // 404 means it's already gone, which is what the caller wanted
  if (!response.ok && response.status !== 404) {
    throw new Error(parseApiError(await response.text(), "Couldn't delete the chat. Please try again."));
  }
}
