import { prisma } from "@/lib/db/prisma";
import type { ConversationDetail, ConversationSummary } from "@/types";

// Every query takes the user ID and filters by it, so a conversation that
// belongs to someone else behaves exactly like one that doesn't exist.

const conversationSummarySelect = { id: true, title: true, updatedAt: true } as const;

function toConversationSummary(row: { id: string; title: string; updatedAt: Date }) {
  return { ...row, updatedAt: row.updatedAt.toISOString() } satisfies ConversationSummary;
}

/** The user's conversations, most recently active first. */
export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const rows = await prisma.conversation.findMany({
    where: { userId },
    select: conversationSummarySelect,
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toConversationSummary);
}

/** A conversation with its documents and messages, or null if the user has no such conversation. */
export async function getConversation(
  userId: string,
  conversationId: string,
): Promise<ConversationDetail | null> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: {
      ...conversationSummarySelect,
      documentIds: true,
      messages: {
        // System messages are instructions to the model, not part of the chat
        where: { role: { in: ["user", "assistant"] } },
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true, createdAt: true },
      },
    },
  });
  if (!conversation) {
    return null;
  }

  // documentIds is a plain array column (no foreign key), so a document
  // deleted since the conversation started is simply missing here
  const documents = await prisma.document.findMany({
    where: { id: { in: conversation.documentIds }, userId },
    select: { id: true, title: true, status: true },
  });
  const byId = new Map(documents.map((document) => [document.id, document]));

  return {
    ...toConversationSummary(conversation),
    documents: conversation.documentIds.flatMap((id) => byId.get(id) ?? []),
    messages: conversation.messages.map((message) => ({
      ...message,
      createdAt: message.createdAt.toISOString(),
    })),
  };
}

export type CreateConversationResult =
  | { status: "created"; conversation: ConversationSummary }
  | { status: "documents_not_found" };

/**
 * Starts a conversation about the given documents. Fails if any of them isn't
 * the user's — the IDs come from the client, and a conversation must never
 * give access to someone else's document.
 */
export async function createConversation(
  userId: string,
  documentIds: string[],
): Promise<CreateConversationResult> {
  const owned = await prisma.document.count({ where: { id: { in: documentIds }, userId } });
  if (owned !== documentIds.length) {
    return { status: "documents_not_found" };
  }
  const row = await prisma.conversation.create({
    data: { userId, documentIds },
    select: conversationSummarySelect,
  });
  return { status: "created", conversation: toConversationSummary(row) };
}

/** Deletes a conversation and its messages. False if the user has no such conversation. */
export async function deleteConversation(userId: string, conversationId: string): Promise<boolean> {
  // deleteMany so the userId filter applies; messages go with it (onDelete: Cascade)
  const { count } = await prisma.conversation.deleteMany({ where: { id: conversationId, userId } });
  return count === 1;
}
