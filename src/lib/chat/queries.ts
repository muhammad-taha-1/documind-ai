import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type {
  ChatMessage,
  ConversationDetail,
  ConversationSummary,
  RetrievalMode,
  SourceChunk,
} from "@/types";

// Every query takes the user ID and filters by it, so a conversation that
// belongs to someone else behaves exactly like one that doesn't exist.

const conversationSummarySelect = { id: true, title: true, updatedAt: true } as const;

function toConversationSummary(row: { id: string; title: string; updatedAt: Date }) {
  return { ...row, updatedAt: row.updatedAt.toISOString() } satisfies ConversationSummary;
}

const chatMessageSelect = {
  id: true,
  role: true,
  content: true,
  createdAt: true,
  retrieval: true,
  sources: {
    orderBy: { position: "asc" },
    select: {
      position: true,
      similarity: true,
      chunk: {
        select: { content: true, pageNumber: true, documentId: true, document: { select: { title: true } } },
      },
    },
  },
} as const satisfies Prisma.MessageSelect;

function toChatMessage(row: Prisma.MessageGetPayload<{ select: typeof chatMessageSelect }>): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    retrieval: row.retrieval,
    sources: row.sources.map(({ position, similarity, chunk }) => ({
      position,
      similarity,
      documentId: chunk.documentId,
      documentTitle: chunk.document.title,
      pageNumber: chunk.pageNumber,
      content: chunk.content,
    })),
  };
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
        select: chatMessageSelect,
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
    messages: conversation.messages.map(toChatMessage),
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

/** How many earlier messages Claude sees with each new one (a sliding window) */
export const HISTORY_MESSAGE_LIMIT = 20;

export interface ChatHistory {
  /** The latest messages, oldest first, always starting with a user message */
  turns: { role: "user" | "assistant"; content: string }[];
  /** True if nothing has been said in this conversation yet */
  isEmpty: boolean;
  /** The documents the chat is about, for retrieval (may include since-deleted ones) */
  documentIds: string[];
}

/** Recent history to send to Claude and the chat's documents, or null if the user has no such conversation. */
export async function getChatHistory(
  userId: string,
  conversationId: string,
  limit = HISTORY_MESSAGE_LIMIT,
): Promise<ChatHistory | null> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: {
      documentIds: true,
      messages: {
        where: { role: { in: ["user", "assistant"] } },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { role: true, content: true },
      },
    },
  });
  if (!conversation) {
    return null;
  }

  const turns = conversation.messages
    .reverse()
    // The query only selects user and assistant messages
    .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));
  // The window can open on an assistant reply; Claude needs a user turn first
  const firstUser = turns.findIndex((turn) => turn.role === "user");
  return {
    turns: firstUser === -1 ? [] : turns.slice(firstUser),
    isEmpty: conversation.messages.length === 0,
    documentIds: conversation.documentIds,
  };
}

export interface ExchangeToSave {
  conversationId: string;
  user: { content: string; createdAt: Date };
  assistant: {
    content: string;
    model: string;
    tokensUsed: number;
    createdAt: Date;
    retrieval: RetrievalMode;
    /** The passages Claude was given, in prompt order (sources[0] is "[Source 1]") */
    sources: SourceChunk[];
  };
  /** Replaces the conversation's title (the first exchange names the chat) */
  title?: string;
}

/**
 * Saves a question and its answer (with the answer's sources) together, and
 * bumps the conversation so it moves to the top of the sidebar. All or
 * nothing: a failed reply never leaves a question without its answer.
 */
export async function saveExchange(exchange: ExchangeToSave) {
  const { conversationId, user, assistant, title } = exchange;
  // Messages are ordered by createdAt, so the answer must sort after its
  // question even if both land in the same millisecond
  const assistantCreatedAt = new Date(
    Math.max(assistant.createdAt.getTime(), user.createdAt.getTime() + 1),
  );

  const [userRow, assistantRow, conversationRow] = await prisma.$transaction(async (tx) => {
    // A document can be deleted or reprocessed while the reply streams, taking
    // its chunks with it. Keep the reply and the sources that still exist,
    // rather than failing the whole exchange on a missing chunk.
    const remaining = await tx.documentChunk.findMany({
      where: { id: { in: assistant.sources.map((source) => source.id) } },
      select: { id: true },
    });
    const remainingIds = new Set(remaining.map((chunk) => chunk.id));

    // One query at a time: a transaction runs on a single connection
    const userMessage = await tx.message.create({
      data: { conversationId, role: "user", content: user.content, createdAt: user.createdAt },
      select: chatMessageSelect,
    });
    const assistantMessage = await tx.message.create({
      data: {
        conversationId,
        role: "assistant",
        content: assistant.content,
        model: assistant.model,
        tokensUsed: assistant.tokensUsed,
        createdAt: assistantCreatedAt,
        retrieval: assistant.retrieval,
        sources: {
          // Numbered before filtering: the reply cites them by these numbers
          create: assistant.sources.flatMap((source, i) =>
            remainingIds.has(source.id)
              ? [{ position: i + 1, chunkId: source.id, similarity: source.similarity }]
              : [],
          ),
        },
      },
      select: chatMessageSelect,
    });
    const conversation = await tx.conversation.update({
      where: { id: conversationId },
      // Setting updatedAt explicitly: a title-less update would otherwise change nothing
      data: { updatedAt: new Date(), ...(title !== undefined && { title }) },
      select: conversationSummarySelect,
    });
    return [userMessage, assistantMessage, conversation] as const;
  });

  return {
    userMessage: toChatMessage(userRow),
    assistantMessage: toChatMessage(assistantRow),
    conversation: toConversationSummary(conversationRow),
  };
}
