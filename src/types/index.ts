export enum DocumentStatus {
  UPLOADING = "UPLOADING",
  PROCESSING = "PROCESSING",
  EMBEDDING = "EMBEDDING",
  READY = "READY",
  ERROR = "ERROR",
}

export enum MessageRole {
  USER = "user",
  ASSISTANT = "assistant",
  SYSTEM = "system",
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

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  conversationId: string;
  model: string | null;
  tokensUsed: number | null;
  sourceChunkIds: string[];
  toolCalls: unknown | null;
  toolResults: unknown | null;
  createdAt: Date;
}

export interface SendMessageRequest {
  conversationId: string;
  message: string;
}

export interface CreateConversationRequest {
  documentIds: string[];
  title?: string;
}
