import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { toVectorLiteral } from "@/lib/db/vectors";
import { fakeEmbedding } from "@/test/embeddings";
import { EMBEDDING_BATCH_SIZE, embedDocumentChunks } from "./embedding";

const generateEmbeddings = vi.hoisted(() => vi.fn<(texts: string[]) => Promise<number[][]>>());
vi.mock("@/lib/ai/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/embeddings")>()),
  generateEmbeddings,
}));

let userId: string;

/** A document with `count` chunks, as chunking leaves it: totalChunks set, nothing embedded. */
async function createChunkedDocument(count: number): Promise<string> {
  const { id } = await prisma.document.create({
    data: {
      title: "t",
      fileName: "t.pdf",
      fileSize: 1,
      filePath: "unused",
      status: "EMBEDDING",
      totalChunks: count,
      userId,
    },
  });
  await prisma.documentChunk.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      documentId: id,
      chunkIndex: i,
      content: `chunk ${i}`,
    })),
  });
  return id;
}

const embeddedChunks = async (id: string) =>
  (await prisma.document.findUniqueOrThrow({ where: { id } })).embeddedChunks;

/** Each chunk's stored embedding as pgvector text, null if not embedded, in chunk order. */
async function storedEmbeddings(documentId: string) {
  return prisma.$queryRaw<{ content: string; embedding: string | null }[]>`
    SELECT content, embedding::text AS embedding FROM "DocumentChunk"
    WHERE "documentId" = ${documentId} ORDER BY "chunkIndex"
  `;
}

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: `embed-${randomUUID()}@test.local` } })).id;
});

beforeEach(async () => {
  await prisma.document.deleteMany({ where: { userId } });
  generateEmbeddings.mockReset().mockImplementation(async (texts) => texts.map(fakeEmbedding));
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("embedDocumentChunks", () => {
  it("embeds every chunk and stores each vector on its own chunk", async () => {
    const id = await createChunkedDocument(3);

    await embedDocumentChunks(id);

    const rows = await storedEmbeddings(id);
    for (const row of rows) {
      expect(row.embedding).toBe(toVectorLiteral(fakeEmbedding(row.content)));
    }
    expect(await embeddedChunks(id)).toBe(3);
  });

  it("sends chunks in order, in batches, advancing progress after each batch", async () => {
    const count = EMBEDDING_BATCH_SIZE * 2 + 5;
    const id = await createChunkedDocument(count);
    const progressAtEachCall: number[] = [];
    generateEmbeddings.mockImplementation(async (texts) => {
      progressAtEachCall.push(await embeddedChunks(id));
      return texts.map(fakeEmbedding);
    });

    await embedDocumentChunks(id);

    const batches = generateEmbeddings.mock.calls.map(([texts]) => texts);
    expect(batches.map((texts) => texts.length)).toEqual([20, 20, 5]);
    expect(batches.flat()).toEqual(Array.from({ length: count }, (_, i) => `chunk ${i}`));
    expect(progressAtEachCall).toEqual([0, 20, 40]);
    expect(await embeddedChunks(id)).toBe(count);
  });

  it("keeps finished batches and stops when a batch fails", async () => {
    const id = await createChunkedDocument(EMBEDDING_BATCH_SIZE + 5);
    generateEmbeddings
      .mockImplementationOnce(async (texts) => texts.map(fakeEmbedding))
      .mockRejectedValueOnce(new Error("API down"));

    await expect(embedDocumentChunks(id)).rejects.toThrow("API down");

    const rows = await storedEmbeddings(id);
    expect(rows.filter((row) => row.embedding !== null)).toHaveLength(EMBEDDING_BATCH_SIZE);
    expect(await embeddedChunks(id)).toBe(EMBEDDING_BATCH_SIZE);
  });

  it("does nothing for a document without chunks", async () => {
    const id = await createChunkedDocument(0);
    await embedDocumentChunks(id);
    expect(generateEmbeddings).not.toHaveBeenCalled();
  });

  it("fails rather than counting progress if a chunk disappears mid-run", async () => {
    const id = await createChunkedDocument(2);
    generateEmbeddings.mockImplementationOnce(async (texts) => {
      // e.g. the user deletes the document while its embeddings are in flight
      await prisma.documentChunk.deleteMany({ where: { documentId: id, chunkIndex: 1 } });
      return texts.map(fakeEmbedding);
    });

    await expect(embedDocumentChunks(id)).rejects.toThrow(/Stored 1 of 2 embeddings/);
    // The transaction rolled back, so neither the vector nor the count was saved
    expect(await embeddedChunks(id)).toBe(0);
    expect((await storedEmbeddings(id))[0].embedding).toBeNull();
  });
});
