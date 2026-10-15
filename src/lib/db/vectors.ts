import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embeddings";
import type { DocumentChunkResult, SourceChunk } from "@/types";
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

// A chunk is "searchable" when it has an embedding and its document belongs
// to the user. Every query below applies the same two conditions, so search,
// size checks and full-text reads always agree on what the user can see.

/** How much searchable text the documents hold, to decide whether to send it all. */
export async function measureSearchableText(
  documentIds: readonly string[],
  userId: string,
): Promise<{ chunks: number; characters: number }> {
  if (documentIds.length === 0) {
    return { chunks: 0, characters: 0 };
  }
  const [row] = await prisma.$queryRaw<{ chunks: number; characters: number }[]>`
    SELECT count(*)::int AS chunks, COALESCE(sum(length(dc.content)), 0)::int AS characters
    FROM "DocumentChunk" dc
    JOIN "Document" d ON dc."documentId" = d.id
    WHERE dc."documentId" = ANY(${documentIds}::text[])
      AND d."userId" = ${userId}
      AND dc.embedding IS NOT NULL
  `;
  return row;
}

/**
 * Every searchable chunk, in reading order: documents in the order given,
 * then each document's chunks from first to last. `similarity` is null
 * because nothing was compared — the caller sends all of it.
 */
export async function listSearchableChunks(documentIds: readonly string[], userId: string): Promise<SourceChunk[]> {
  if (documentIds.length === 0) {
    return [];
  }
  return prisma.$queryRaw`
    SELECT dc.id, dc.content, dc."pageNumber", dc."chunkIndex", dc."documentId",
           d.title AS "documentTitle", NULL::float8 AS similarity
    FROM "DocumentChunk" dc
    JOIN "Document" d ON dc."documentId" = d.id
    WHERE dc."documentId" = ANY(${documentIds}::text[])
      AND d."userId" = ${userId}
      AND dc.embedding IS NOT NULL
    ORDER BY array_position(${documentIds}::text[], dc."documentId"), dc."chunkIndex"
  `;
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
