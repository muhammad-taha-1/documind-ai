import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { CompactionBlock } from "@/lib/ai/chat";
import { fitHistory, parseCompactionBlock } from "@/lib/ai/context";
import type { HistoryTurn } from "@/lib/ai/vision";
import { attachmentPath, isImageMediaType } from "@/lib/chat/attachments";
import type { NewAttachment } from "@/lib/chat/images";
import { prisma } from "@/lib/db/prisma";
import { deleteFilesQuietly } from "@/lib/storage";
import type {
  ChatAttachment,
  ChatMessage,
  ConversationDetail,
  ConversationDocument,
  ConversationSummary,
  RetrievalMode,
  SourceChunk,
  TokenUsage,
  ToolCall,
} from "@/types";

// Every query takes the user ID and filters by it, so a conversation that
// belongs to someone else behaves exactly like one that doesn't exist.

const conversationSummarySelect = { id: true, title: true, updatedAt: true } as const;

function toConversationSummary({ id, title, updatedAt }: { id: string; title: string; updatedAt: Date }) {
  // Picked field by field: rows often carry more (documentIds, messages)
  return { id, title, updatedAt: updatedAt.toISOString() } satisfies ConversationSummary;
}

// Message.toolCalls is a JSON column, so its shape is checked on the way out
const toolCallsSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    input: z.unknown(),
    label: z.string(),
    status: z.enum(["running", "done", "failed"]),
    output: z.string().nullable(),
  }),
) satisfies z.ZodType<ToolCall[]>;

function parseToolCalls(messageId: string, value: Prisma.JsonValue): ToolCall[] {
  if (value === null) {
    return [];
  }
  const parsed = toolCallsSchema.safeParse(value);
  if (!parsed.success) {
    // Don't break the whole chat over one message's tool history
    console.error(`Message ${messageId} has malformed toolCalls`, parsed.error);
    return [];
  }
  return parsed.data;
}

const chatMessageSelect = {
  id: true,
  role: true,
  content: true,
  createdAt: true,
  retrieval: true,
  toolCalls: true,
  inputTokens: true,
  outputTokens: true,
  cacheReadTokens: true,
  cacheWriteTokens: true,
  attachments: {
    orderBy: { position: "asc" },
    select: { id: true, fileName: true, mediaType: true, width: true, height: true },
  },
  sources: {
    orderBy: { position: "asc" },
    select: {
      position: true,
      similarity: true,
      chunk: {
        select: {
          id: true,
          content: true,
          pageNumber: true,
          documentId: true,
          document: { select: { title: true } },
        },
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
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentTitle: chunk.document.title,
      pageNumber: chunk.pageNumber,
      content: chunk.content,
    })),
    toolCalls: parseToolCalls(row.id, row.toolCalls),
    attachments: row.attachments.flatMap(({ id, fileName, mediaType, width, height }): ChatAttachment[] =>
      // Stored types are checked on upload; anything else can't be shown safely
      isImageMediaType(mediaType) ? [{ id, name: fileName, mediaType, width, height, url: attachmentPath(id) }] : [],
    ),
    // All four are written together, so one null means no usage was recorded
    usage:
      row.inputTokens === null ||
      row.outputTokens === null ||
      row.cacheReadTokens === null ||
      row.cacheWriteTokens === null
        ? null
        : {
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            cacheReadTokens: row.cacheReadTokens,
            cacheWriteTokens: row.cacheWriteTokens,
          },
  };
}

/** A document a chat is about, as the chat route needs it */
export interface ChatDocument {
  id: string;
  title: string;
  pageCount: number | null;
}

/**
 * The chat's documents that still exist and belong to the user, in the order
 * they were picked. documentIds is a plain array column (no foreign key), so
 * a document deleted since the chat started is simply left out.
 */
async function findChatDocuments(userId: string, documentIds: string[]) {
  const documents = await prisma.document.findMany({
    where: { id: { in: documentIds }, userId },
    select: { id: true, title: true, status: true, pageCount: true },
  });
  const byId = new Map(documents.map((document) => [document.id, document]));
  return documentIds.flatMap((id) => byId.get(id) ?? []);
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
export async function getConversation(userId: string, conversationId: string): Promise<ConversationDetail | null> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: {
      ...conversationSummarySelect,
      documentIds: true,
      compaction: true,
      compactedThrough: true,
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

  const documents = await findChatDocuments(userId, conversation.documentIds);
  const compaction = parseCompactionBlock(conversation.id, conversation.compaction);

  return {
    ...toConversationSummary(conversation),
    documents: documents.map(toConversationDocument),
    messages: conversation.messages.map(toChatMessage),
    compaction:
      compaction?.content && conversation.compactedThrough
        ? { summary: compaction.content, through: conversation.compactedThrough.toISOString() }
        : null,
  };
}

function toConversationDocument({ id, title, status }: ConversationDocument): ConversationDocument {
  return { id, title, status };
}

export type CreateConversationResult =
  | { status: "created"; conversation: ConversationSummary }
  | { status: "documents_not_found" };

/**
 * Starts a conversation about the given documents. Fails if any of them isn't
 * the user's — the IDs come from the client, and a conversation must never
 * give access to someone else's document.
 */
export async function createConversation(userId: string, documentIds: string[]): Promise<CreateConversationResult> {
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

/**
 * Deletes a conversation, its messages and their images. False if the user
 * has no such conversation.
 */
export async function deleteConversation(userId: string, conversationId: string): Promise<boolean> {
  const storageKeys = await prisma.$transaction(async (tx) => {
    // Read just before the delete. (A reply saved at that very moment could
    // still leave a stray file, which wastes space but breaks nothing.)
    const attachments = await tx.messageAttachment.findMany({
      where: { message: { conversation: { id: conversationId, userId } } },
      select: { storageKey: true },
    });
    // deleteMany so the userId filter applies; messages and attachment rows
    // go with it (onDelete: Cascade)
    const { count } = await tx.conversation.deleteMany({ where: { id: conversationId, userId } });
    return count === 1 ? attachments.map((attachment) => attachment.storageKey) : null;
  });
  if (storageKeys === null) {
    return false;
  }
  // Only once the rows are gone: a failed delete leaves a stray file, never a
  // message pointing at a missing one
  await deleteFilesQuietly(storageKeys);
  return true;
}

/** An attached image's stored file, or null if the user has no such attachment. */
export async function getAttachmentFile(userId: string, attachmentId: string) {
  return prisma.messageAttachment.findFirst({
    where: { id: attachmentId, message: { conversation: { userId } } },
    select: { storageKey: true, mediaType: true, fileName: true },
  });
}

export type UpdateConversationResult =
  | { status: "updated"; conversation: ConversationSummary; documents: ConversationDocument[] }
  | { status: "not_found" }
  | { status: "documents_not_found" };

/**
 * Renames a conversation and/or replaces its documents. As when creating
 * one, every document must be the user's. Neither change counts as activity,
 * so the conversation keeps its place in the sidebar.
 */
export async function updateConversation(
  userId: string,
  conversationId: string,
  changes: { title?: string; documentIds?: string[] },
): Promise<UpdateConversationResult> {
  const { title, documentIds } = changes;
  if (documentIds) {
    const owned = await prisma.document.count({ where: { id: { in: documentIds }, userId } });
    if (owned !== documentIds.length) {
      return { status: "documents_not_found" };
    }
  }

  // updateMany so the userId filter applies
  const { count } = await prisma.conversation.updateMany({
    where: { id: conversationId, userId },
    data: { title, documentIds },
  });
  if (count === 0) {
    return { status: "not_found" };
  }

  const row = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { ...conversationSummarySelect, documentIds: true },
  });
  const documents = await findChatDocuments(userId, row.documentIds);
  return {
    status: "updated",
    conversation: toConversationSummary(row),
    documents: documents.map(toConversationDocument),
  };
}

const historyImageSelect = {
  orderBy: { position: "asc" },
  select: { id: true, fileName: true, mediaType: true, storageKey: true, byteSize: true },
} as const satisfies Prisma.Message$attachmentsArgs;

function toHistoryTurn(message: { role: string; content: string; attachments: HistoryTurn["images"] }): HistoryTurn {
  // The queries only select user and assistant messages
  return { role: message.role as HistoryTurn["role"], content: message.content, images: message.attachments };
}

export interface ChatHistory {
  /** The summary of the older messages, if the conversation has been compacted */
  compaction: CompactionBlock | null;
  /** The messages after the summary, oldest first, starting with a user message. Images are still on disk (vision.ts). */
  turns: HistoryTurn[];
  /** True if nothing has been said in this conversation yet */
  isEmpty: boolean;
  /** The chat's documents, for retrieval and tools (deleted ones left out) */
  documents: ChatDocument[];
}

/**
 * What Claude sees of a conversation (see context.ts): the summary of the
 * older messages, if there is one, and every message after it. Also the
 * chat's documents. Null if the user has no such conversation.
 */
export async function getChatHistory(userId: string, conversationId: string): Promise<ChatHistory | null> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { documentIds: true, compaction: true, compactedThrough: true },
  });
  if (!conversation) {
    return null;
  }

  const compaction = parseCompactionBlock(conversationId, conversation.compaction);
  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      role: { in: ["user", "assistant"] },
      // Without a usable summary, fall back to the whole conversation
      ...(compaction && conversation.compactedThrough && { createdAt: { gt: conversation.compactedThrough } }),
    },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true, attachments: historyImageSelect },
  });

  const turns = messages.map(toHistoryTurn);
  const fitted = fitHistory(turns);
  if (fitted.length < turns.length) {
    console.warn(
      `Conversation ${conversationId}: history over budget, sending the last ${fitted.length} of ${turns.length} messages`,
    );
  }

  const documents = await findChatDocuments(userId, conversation.documentIds);
  return {
    compaction,
    turns: fitted,
    isEmpty: compaction === null && messages.length === 0,
    documents: documents.map(({ id, title, pageCount }) => ({ id, title, pageCount })),
  };
}

/** A conversation as compaction needs it: its current summary and the messages after it */
export async function getCompactionState(conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { compaction: true, compactedThrough: true },
  });
  if (!conversation) {
    return null;
  }
  const compaction = parseCompactionBlock(conversationId, conversation.compaction);
  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      role: { in: ["user", "assistant"] },
      ...(compaction && conversation.compactedThrough && { createdAt: { gt: conversation.compactedThrough } }),
    },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true, createdAt: true, attachments: historyImageSelect },
  });
  return {
    compaction,
    // As stored, even if the block is unusable: saveCompaction's compare-and-set
    // checks it to make sure nobody else compacted in the meantime
    compactedThrough: conversation.compactedThrough,
    messages: messages.map((message) => ({ ...toHistoryTurn(message), createdAt: message.createdAt })),
  };
}

/**
 * Stores a new summary covering every message up to `through`, unless the
 * conversation was compacted by someone else since `expectedThrough` was
 * read (two replies finishing at once can both try). False if it was, or if
 * the conversation is gone.
 */
export async function saveCompaction(
  conversationId: string,
  {
    block,
    through,
    expectedThrough,
  }: { block: Anthropic.Beta.BetaCompactionBlock; through: Date; expectedThrough: Date | null },
): Promise<boolean> {
  const { count } = await prisma.conversation.updateMany({
    where: { id: conversationId, compactedThrough: expectedThrough },
    // The API's response is JSON, so the block is a JSON value
    data: { compaction: block as unknown as Prisma.InputJsonValue, compactedThrough: through },
  });
  return count === 1;
}

export interface ExchangeToSave {
  conversationId: string;
  user: {
    content: string;
    createdAt: Date;
    /** Images whose files are already stored (images.ts storeImages) */
    attachments: readonly NewAttachment[];
  };
  assistant: {
    content: string;
    model: string;
    usage: TokenUsage;
    /** The whole prompt of the reply's first request, in tokens */
    contextTokens: number;
    createdAt: Date;
    retrieval: RetrievalMode;
    /** The passages Claude was given, in prompt order (sources[0] is "[Source 1]") */
    sources: readonly SourceChunk[];
    /** Tools Claude used, with their results */
    toolCalls: readonly ToolCall[];
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
  const assistantCreatedAt = new Date(Math.max(assistant.createdAt.getTime(), user.createdAt.getTime() + 1));

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
      data: {
        conversationId,
        role: "user",
        content: user.content,
        createdAt: user.createdAt,
        attachments: { create: user.attachments.map((attachment) => ({ ...attachment })) },
      },
      select: chatMessageSelect,
    });
    const assistantMessage = await tx.message.create({
      data: {
        conversationId,
        role: "assistant",
        content: assistant.content,
        model: assistant.model,
        ...assistant.usage,
        contextTokens: assistant.contextTokens,
        createdAt: assistantCreatedAt,
        retrieval: assistant.retrieval,
        toolCalls:
          assistant.toolCalls.length > 0
            ? assistant.toolCalls.map((call) => ({
                ...call,
                // Parsed from the API's JSON response, so it is a JSON value
                input: call.input as Prisma.InputJsonValue,
              }))
            : undefined,
        sources: {
          // Numbered before filtering: the reply cites them by these numbers
          create: assistant.sources.flatMap((source, i) =>
            remainingIds.has(source.id) ? [{ position: i + 1, chunkId: source.id, similarity: source.similarity }] : [],
          ),
        },
      },
      select: chatMessageSelect,
    });
    const conversation = await tx.conversation.update({
      where: { id: conversationId },
      // New messages are activity: move the chat to the top of the sidebar
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
