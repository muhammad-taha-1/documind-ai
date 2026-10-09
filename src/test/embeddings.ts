import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings";

/** A 1536-dimension vector with the given values at the given indexes, zero elsewhere. */
export function makeVector(entries: Record<number, number>): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const [index, value] of Object.entries(entries)) {
    vector[Number(index)] = value;
  }
  return vector;
}

/**
 * Stands in for a real embedding in tests, so they need no API key or
 * network: the same text always gives the same valid vector.
 */
export function fakeEmbedding(text: string): number[] {
  let hash = 0;
  for (const char of text) {
    hash = (hash * 31 + char.charCodeAt(0)) % EMBEDDING_DIMENSIONS;
  }
  return makeVector({ [hash]: 1 });
}
