import { listSearchableChunks, measureSearchableText, searchSimilarChunks } from "@/lib/db/vectors";
import type { DocumentChunkResult, RetrievalMode, SourceChunk } from "@/types";
import { generateEmbedding } from "./embeddings";
import { LOW_CONFIDENCE_SIMILARITY, MIN_SIMILARITY } from "./relevance";

// Retrieval: the "R" in RAG. Given a question, find the parts of the chat's
// documents Claude should read before answering. Turning them into a prompt
// is prompts.ts (buildRAGPrompt); generating the answer is chat.ts.

// Thresholds live in relevance.ts, which the chat UI shares
export { LOW_CONFIDENCE_SIMILARITY, MIN_SIMILARITY } from "./relevance";

/** How many passages a search sends */
export const TOP_K = 5;

/**
 * Documents holding at most this much text are sent whole instead of
 * searched. A search sends up to TOP_K chunks of ~1,500 characters (about
 * 7,500 characters) anyway, so the full text of a document this size costs
 * little more, and it answers questions about the whole document ("is this
 * resume ok?") that match no single passage well.
 */
export const FULL_TEXT_MAX_CHARACTERS = 12_000;

/**
 * The passages closest in meaning to `query`, best first, without the
 * clearly unrelated ones. Used for each question and by the search tool.
 */
export async function searchPassages(
  query: string,
  documentIds: readonly string[],
  userId: string,
  { topK = TOP_K, signal }: { topK?: number; signal?: AbortSignal } = {},
): Promise<DocumentChunkResult[]> {
  // 1. Embed the query with the same model as the chunks, so the vectors are comparable
  const queryEmbedding = await generateEmbedding(query, { signal });
  // 2. Find the closest chunks, dropping what scores below the floor
  const results = await searchSimilarChunks(queryEmbedding, documentIds, userId, topK);
  return results.filter((chunk) => chunk.similarity >= MIN_SIMILARITY);
}

export interface RetrievedContext {
  mode: RetrievalMode;
  /** The passages to give Claude, in order: the first is "[Source 1]" */
  sources: SourceChunk[];
}

/**
 * Finds the passages from the user's documents that Claude needs to answer
 * `question`. Only the user's own documents are read, whatever IDs are passed.
 *
 * A null question (images sent without a message) has nothing to search
 * with. Small documents are still sent whole; larger ones aren't searched,
 * and Claude can search them itself once it has seen the images.
 */
export async function retrieveContext(
  question: string | null,
  documentIds: readonly string[],
  userId: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<RetrievedContext> {
  const { chunks, characters } = await measureSearchableText(documentIds, userId);
  if (chunks === 0) {
    return { mode: "NO_DOCUMENTS", sources: [] };
  }

  if (characters <= FULL_TEXT_MAX_CHARACTERS) {
    // Everything fits, so there's nothing to search (or embed)
    return { mode: "FULL_TEXT", sources: await listSearchableChunks(documentIds, userId) };
  }
  if (question === null) {
    return { mode: "NOT_SEARCHED", sources: [] };
  }

  const sources = await searchPassages(question, documentIds, userId, { signal });
  if (sources.length === 0) {
    return { mode: "NO_MATCH", sources };
  }
  // Results are sorted, so the first is the best
  const mode = sources[0].similarity < LOW_CONFIDENCE_SIMILARITY ? "WEAK_MATCH" : "MATCHED";
  return { mode, sources };
}
