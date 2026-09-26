import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";

/**
 * Phase 2 integration test: proves pgvector works end-to-end through Prisma 7's
 * driver adapter — the extension is installed, the `embedding vector(1536)`
 * column accepts writes via $executeRaw, and cosine-distance search via
 * $queryRaw returns correctly ordered, correctly scoped results.
 *
 * Uses tiny hand-made vectors instead of real embeddings so the expected
 * similarities are known exactly and no API credits are needed.
 */

const DIMENSIONS = 1536;

/** A 1536-dim vector with the given values at the given indexes, zero elsewhere. */
function makeVector(entries: Record<number, number>): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  for (const [index, value] of Object.entries(entries)) {
    vector[Number(index)] = value;
  }
  return vector;
}

/** pgvector's text format: "[0.1,0.2,...]" */
function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

async function setEmbedding(chunkId: string, vector: number[]): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "DocumentChunk"
    SET embedding = ${toVectorLiteral(vector)}::vector
    WHERE id = ${chunkId}
  `;
}

interface SearchRow {
  id: string;
  documentId: string;
  similarity: number;
}

/** Same query shape Phase 7's searchSimilarChunks will use. */
async function search(
  query: number[],
  documentIds: string[],
  userId: string,
  limit = 5,
): Promise<SearchRow[]> {
  return prisma.$queryRaw<SearchRow[]>`
    SELECT dc.id, dc."documentId",
           1 - (dc.embedding <=> ${toVectorLiteral(query)}::vector) AS similarity
    FROM "DocumentChunk" dc
    JOIN "Document" d ON dc."documentId" = d.id
    WHERE dc."documentId" = ANY(${documentIds}::text[])
      AND d."userId" = ${userId}
      AND dc.embedding IS NOT NULL
    ORDER BY dc.embedding <=> ${toVectorLiteral(query)}::vector
    LIMIT ${limit}
  `;
}

describe("pgvector via Prisma", () => {
  const runId = randomUUID();
  let ownerId: string;
  let otherUserId: string;
  let ownerDocId: string;
  let otherDocId: string;
  const chunkIds: Record<"exact" | "partial" | "unrelated" | "unembedded" | "otherUsers", string> = {
    exact: "",
    partial: "",
    unrelated: "",
    unembedded: "",
    otherUsers: "",
  };

  beforeAll(async () => {
    const owner = await prisma.user.create({ data: { email: `owner-${runId}@test.local` } });
    const other = await prisma.user.create({ data: { email: `other-${runId}@test.local` } });
    ownerId = owner.id;
    otherUserId = other.id;

    const docFields = { fileName: "t.pdf", fileSize: 1, filePath: "/dev/null" };
    const ownerDoc = await prisma.document.create({
      data: { ...docFields, title: "Owner doc", userId: ownerId },
    });
    const otherDoc = await prisma.document.create({
      data: { ...docFields, title: "Other user's doc", userId: otherUserId },
    });
    ownerDocId = ownerDoc.id;
    otherDocId = otherDoc.id;

    const makeChunk = async (documentId: string, chunkIndex: number) =>
      (await prisma.documentChunk.create({
        data: { documentId, chunkIndex, content: `chunk ${chunkIndex}` },
      })).id;

    chunkIds.exact = await makeChunk(ownerDocId, 0);
    chunkIds.partial = await makeChunk(ownerDocId, 1);
    chunkIds.unrelated = await makeChunk(ownerDocId, 2);
    chunkIds.unembedded = await makeChunk(ownerDocId, 3);
    chunkIds.otherUsers = await makeChunk(otherDocId, 0);

    // Query vector will be e0. Cosine similarity to each chunk:
    //   exact      = e0              -> 1.0
    //   partial    = (e0 + e1)/√2    -> ~0.707
    //   unrelated  = e1              -> 0.0 (orthogonal)
    //   otherUsers = e0              -> 1.0, but belongs to another user
    await setEmbedding(chunkIds.exact, makeVector({ 0: 1 }));
    await setEmbedding(chunkIds.partial, makeVector({ 0: Math.SQRT1_2, 1: Math.SQRT1_2 }));
    await setEmbedding(chunkIds.unrelated, makeVector({ 1: 1 }));
    await setEmbedding(chunkIds.otherUsers, makeVector({ 0: 1 }));
  });

  afterAll(async () => {
    // Cascades remove documents and chunks
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it("has the vector extension installed", async () => {
    const rows = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    expect(rows).toHaveLength(1);
  });

  it("stores embeddings with 1536 dimensions", async () => {
    const [row] = await prisma.$queryRaw<{ dims: number }[]>`
      SELECT vector_dims(embedding) AS dims FROM "DocumentChunk" WHERE id = ${chunkIds.exact}
    `;
    expect(row.dims).toBe(DIMENSIONS);
  });

  it("rejects embeddings with the wrong dimension count", async () => {
    await expect(
      prisma.$executeRaw`
        UPDATE "DocumentChunk" SET embedding = ${"[1,2,3]"}::vector WHERE id = ${chunkIds.unembedded}
      `,
    ).rejects.toThrow();
  });

  it("returns chunks ordered by cosine similarity with correct scores", async () => {
    const results = await search(makeVector({ 0: 1 }), [ownerDocId], ownerId);

    expect(results.map((r) => r.id)).toEqual([
      chunkIds.exact,
      chunkIds.partial,
      chunkIds.unrelated,
    ]);
    expect(results[0].similarity).toBeCloseTo(1, 5);
    expect(results[1].similarity).toBeCloseTo(Math.SQRT1_2, 5);
    expect(results[2].similarity).toBeCloseTo(0, 5);
  });

  it("skips chunks that have no embedding yet", async () => {
    const results = await search(makeVector({ 0: 1 }), [ownerDocId], ownerId);
    expect(results.map((r) => r.id)).not.toContain(chunkIds.unembedded);
  });

  it("respects the limit", async () => {
    const results = await search(makeVector({ 0: 1 }), [ownerDocId], ownerId, 2);
    expect(results).toHaveLength(2);
  });

  it("never returns another user's chunks, even when their document ID is passed", async () => {
    // Simulates a malicious client sending someone else's document ID
    const results = await search(makeVector({ 0: 1 }), [ownerDocId, otherDocId], ownerId);

    expect(results.every((r) => r.documentId === ownerDocId)).toBe(true);
    expect(results.map((r) => r.id)).not.toContain(chunkIds.otherUsers);
  });

  it("cascades chunk deletion when a document is deleted", async () => {
    const doc = await prisma.document.create({
      data: { title: "temp", fileName: "t.pdf", fileSize: 1, filePath: "/dev/null", userId: ownerId },
    });
    await prisma.documentChunk.create({ data: { documentId: doc.id, chunkIndex: 0, content: "x" } });

    await prisma.document.delete({ where: { id: doc.id } });

    expect(await prisma.documentChunk.count({ where: { documentId: doc.id } })).toBe(0);
  });

  it("initialises new documents with zeroed progress counters", async () => {
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: ownerDocId } });
    expect(doc.status).toBe("UPLOADING");
    expect(doc.totalChunks).toBe(0);
    expect(doc.embeddedChunks).toBe(0);
    expect(doc.errorMessage).toBeNull();
  });
});
