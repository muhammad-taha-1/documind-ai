import { listSearchableChunks, measureSearchableText, searchSimilarChunks } from "@/lib/db/vectors";
import type { DocumentChunkResult, RetrievalMode, SourceChunk } from "@/types";
import { generateEmbedding } from "./embeddings";

// Retrieval: the "R" in RAG. Given a question, find the parts of the chat's
// documents Claude should read before answering. Turning them into a prompt
// is prompts.ts (buildRAGPrompt); generating the answer is chat.ts.

/*
 * Similarity thresholds for text-embedding-3-small, measured on real
 * documents (a resume and a 10-page AWS Q&A, 2026-10-12):
 *
 *   right passage for a specific question   0.24 – 0.67
 *   small talk ("hi", "thanks!")            ≤ 0.19
 *   unrelated questions (recipes, CSS)      ≤ 0.10
 *
 * Similarity ranks passages well but isn't a calibrated confidence: the
 * right passage for "What is his email address?" scored only 0.24, close to
 * small talk. So the floor only drops what is clearly unrelated, and Claude,
 * which reads the passages, judges whether they answer the question.
 */

/** Passages scoring below this aren't sent */
export const MIN_SIMILARITY = 0.2;

/** If even the best passage scores below this, the match is flagged as weak */
export const LOW_CONFIDENCE_SIMILARITY = 0.3;

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
 */
export async function retrieveContext(
  question: string,
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

  const sources = await searchPassages(question, documentIds, userId, { signal });
  if (sources.length === 0) {
    return { mode: "NO_MATCH", sources };
  }
  // Results are sorted, so the first is the best
  const mode = sources[0].similarity < LOW_CONFIDENCE_SIMILARITY ? "WEAK_MATCH" : "MATCHED";
  return { mode, sources };
}
