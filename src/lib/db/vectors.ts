import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings";
import type { DocumentChunkResult } from "@/types";
import { prisma } from "./prisma";

// Prisma can't read or write `vector` columns through its query API, so
// vectors go through raw SQL. Tagged-template $queryRaw / $executeRaw send
// every ${} as a bound parameter — never build these queries as strings.

/**
 * Formats a vector as pgvector's text input ("[0.1,0.2,...]"), to be cast
 * with `::vector` in SQL. Checks the shape first so a bad vector fails here
 * with a clear message rather than deep inside Postgres.
 */
export function toVectorLiteral(vector: readonly number[]): string {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new RangeError(`Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${vector.length}`);
  }
  if (!vector.every(Number.isFinite)) {
    throw new RangeError("Vector contains a non-finite value");
  }
  return `[${vector.join(",")}]`;
}

/**
 * The `limit` chunks closest in meaning to the query, most similar first.
 *
 * Filters by `userId` as well as `documentIds`: the IDs come from the client,
 * so without the user check someone could pass another user's document IDs
 * and read their content. Similarity thresholds are the caller's job (the RAG
 * pipeline) — this stays a plain "top K nearest" search.
 */
export async function searchSimilarChunks(
  queryEmbedding: readonly number[],
  documentIds: readonly string[],
  userId: string,
  limit = 5,
): Promise<DocumentChunkResult[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`limit must be a positive integer, got ${limit}`);
  }
  if (documentIds.length === 0) {
    return [];
  }
  const query = toVectorLiteral(queryEmbedding);

  // `<=>` is cosine distance (0 = same direction), so similarity = 1 - distance
  return prisma.$queryRaw<DocumentChunkResult[]>`
    SELECT dc.id, dc.content, dc."pageNumber", dc."chunkIndex", dc."documentId",
           d.title AS "documentTitle",
           1 - (dc.embedding <=> ${query}::vector) AS similarity
    FROM "DocumentChunk" dc
    JOIN "Document" d ON dc."documentId" = d.id
    WHERE dc."documentId" = ANY(${documentIds}::text[])
      AND d."userId" = ${userId}
      AND dc.embedding IS NOT NULL
    ORDER BY dc.embedding <=> ${query}::vector
    LIMIT ${limit}
  `;
}
