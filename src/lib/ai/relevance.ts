// How well a passage matches a question. Its own module, free of server
// imports, so retrieval (rag.ts) and the chat UI share the same thresholds.

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

export type Relevance = "close" | "loose";

/**
 * A label for a source's similarity score. Deliberately not a percentage:
 * right answers score as low as 0.24, which would read as "24% relevant".
 * Null when nothing was compared (the full text was sent, or Claude looked
 * the page up).
 */
export function relevanceOf(similarity: number | null): Relevance | null {
  if (similarity === null) {
    return null;
  }
  return similarity >= LOW_CONFIDENCE_SIMILARITY ? "close" : "loose";
}
