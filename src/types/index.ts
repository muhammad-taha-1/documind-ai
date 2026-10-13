// Enums come from Prisma's generated enums file, which is safe to import in
// client components (it has no database code), so they can't drift from the schema.
import type { DocumentStatus, MessageRole, RetrievalMode } from "@/generated/prisma/enums";

export { DocumentStatus, MessageRole, RetrievalMode } from "@/generated/prisma/enums";

/** A document as the API and UI see it — no server file paths. */
export interface DocumentSummary {
  id: string;
  title: string;
  fileName: string;
  fileSize: number;
  pageCount: number | null;
  status: DocumentStatus;
  errorMessage: string | null;
  totalChunks: number;
  embeddedChunks: number;
  /** ISO 8601 — a string so it survives JSON responses unchanged */
  createdAt: string;
}

export interface DocumentChunkResult {
  id: string;
  content: string;
  pageNumber: number | null;
  chunkIndex: number;
  documentId: string;
  documentTitle: string;
  similarity: number;
}

/**
 * A passage given to Claude as context: a search result, or one chunk of a
 * document sent in full (then similarity is null — nothing was compared).
 */
export type SourceChunk = Omit<DocumentChunkResult, "similarity"> & { similarity: number | null };

/** A source shown under an assistant reply */
export interface ChatSource {
  /** The N in "[Source N]" */
  position: number;
  documentId: string;
  documentTitle: string;
  pageNumber: number | null;
  content: string;
  /** Cosine similarity to the question; null when the full text was sent */
  similarity: number | null;
}

/** A conversation as the sidebar lists it */
export interface ConversationSummary {
  id: string;
  title: string;
  /** ISO 8601. Bumped when messages are added, so the list sorts by recent activity */
  updatedAt: string;
}

/** A document attached to a conversation, as the chat page shows it */
export interface ConversationDocument {
  id: string;
  title: string;
  status: DocumentStatus;
}

/**
 * A tool Claude used while writing a reply, with what it returned. Stored on
 * the reply (Message.toolCalls) and streamed live while the reply is written.
 */
export interface ToolCall {
  /** The tool_use ID from the API */
  id: string;
  /** The tool's name, e.g. "search_documents" */
  name: string;
  /** The arguments Claude passed, as it sent them */
  input: unknown;
  /** What the call did, for people: `Searched for "load balancers"` */
  label: string;
  status: "running" | "done" | "failed";
  /** What Claude got back; null while running */
  output: string | null;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  /** ISO 8601 */
  createdAt: string;
  /** How the documents were searched for this reply; null for user messages and pre-RAG replies */
  retrieval: RetrievalMode | null;
  /** The passages the reply was based on, by source number. Empty for user messages. */
  sources: ChatSource[];
  /** Tools Claude used for this reply, in the order it called them. Empty for user messages. */
  toolCalls: ToolCall[];
  /** What the reply cost in tokens; null for user messages and replies from before tracking began */
  usage: TokenUsage | null;
}

/**
 * Tokens a reply used, across every request behind it. The four kinds are
 * billed at different rates, so they're kept apart: cache reads cost a tenth
 * of normal input, cache writes 1.25x.
 */
export interface TokenUsage {
  /** Prompt tokens billed at the full input rate */
  inputTokens: number;
  /** Generated tokens, thinking included */
  outputTokens: number;
  /** Prompt tokens read from the prompt cache */
  cacheReadTokens: number;
  /** Prompt tokens written to the prompt cache */
  cacheWriteTokens: number;
}

/** The summary that stands in for a conversation's older messages */
export interface ConversationCompaction {
  /** What Claude reads instead of the older messages */
  summary: string;
  /** ISO 8601. Messages created at or before this time are summarized. */
  through: string;
}

/** Everything the chat page needs to render a conversation */
export interface ConversationDetail extends ConversationSummary {
  /** Documents the user picked, oldest selection first. Deleted documents are left out. */
  documents: ConversationDocument[];
  /** Oldest first. All of them, including those Claude now sees only as a summary. */
  messages: ChatMessage[];
  /** Null until the conversation outgrows its context budget */
  compaction: ConversationCompaction | null;
}

/** Why a request to Claude is being retried: too many requests (429), or the service is struggling (5xx, timeouts) */
export type RetryReason = "rate_limited" | "unavailable";

/**
 * One line of the POST /api/chat response stream (newline-delimited JSON).
 * A stream is any number of `delta`, `tool` and `retry` events, then exactly one `done` or `error`.
 */
export type ChatStreamEvent =
  /** The next piece of the reply */
  | { type: "delta"; text: string }
  /** A tool call started (status "running") or finished; the latest event for an ID wins */
  | { type: "tool"; call: ToolCall }
  /**
   * Claude is busy (rate limited or overloaded), so the server waits `delayMs`
   * and tries again. The reply continues with the next event.
   */
  | { type: "retry"; reason: RetryReason; delayMs: number }
  /** The reply finished and both messages were saved */
  | {
      type: "done";
      userMessage: ChatMessage;
      assistantMessage: ChatMessage;
      /** The conversation after the exchange (new title, bumped updatedAt) */
      conversation: ConversationSummary;
    }
  /** Nothing was saved; the message can be sent again */
  | { type: "error"; error: string };
