// Enums come from Prisma's generated enums file, which is safe to import in
// client components (it has no database code), so they can't drift from the schema.
import type { DocumentStatus, MessageRole } from "@/generated/prisma/enums";

export { DocumentStatus, MessageRole } from "@/generated/prisma/enums";

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

/** A conversation as the sidebar lists it */
export interface ConversationSummary {
  id: string;
  title: string;
  /** ISO 8601. Bumped whenever the conversation changes, so the list sorts by recent activity */
  updatedAt: string;
}

/** A document attached to a conversation, as the chat page shows it */
export interface ConversationDocument {
  id: string;
  title: string;
  status: DocumentStatus;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  /** ISO 8601 */
  createdAt: string;
}

/** Everything the chat page needs to render a conversation */
export interface ConversationDetail extends ConversationSummary {
  /** Documents the user picked, oldest selection first. Deleted documents are left out. */
  documents: ConversationDocument[];
  /** Oldest first */
  messages: ChatMessage[];
}

/**
 * One line of the POST /api/chat response stream (newline-delimited JSON).
 * A stream is any number of `delta`s, then exactly one `done` or `error`.
 */
export type ChatStreamEvent =
  /** The next piece of the reply */
  | { type: "delta"; text: string }
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
