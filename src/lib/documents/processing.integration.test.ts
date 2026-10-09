import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { fakeEmbedding } from "@/test/embeddings";
import { makePdf } from "@/test/pdf";
import { chunkPages } from "./chunker";
import { claimDocumentForProcessing, NO_TEXT_MESSAGE, runProcessing } from "./processing";
import { documentStorageKey, saveFile } from "./storage";

const generateEmbeddings = vi.hoisted(() => vi.fn<(texts: string[]) => Promise<number[][]>>());
vi.mock("@/lib/ai/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/embeddings")>()),
  generateEmbeddings,
}));

let uploadRoot: string;
let ownerId: string;
let otherUserId: string;

/** Creates a document row, and its file on disk unless `bytes` is null. */
async function createDocument(
  bytes: Uint8Array | null,
  status: DocumentStatus = "UPLOADING",
): Promise<string> {
  const id = randomUUID();
  const filePath = documentStorageKey(ownerId, id);
  if (bytes) await saveFile(filePath, bytes);
  await prisma.document.create({
    data: { id, title: "t", fileName: "t.pdf", fileSize: 1, filePath, status, userId: ownerId },
  });
  return id;
}

const findDocument = (id: string) => prisma.document.findUniqueOrThrow({ where: { id } });

const findChunks = (documentId: string) =>
  prisma.documentChunk.findMany({
    where: { documentId },
    orderBy: { chunkIndex: "asc" },
    select: { chunkIndex: true, content: true, pageNumber: true, tokenCount: true },
  });

async function countEmbedded(documentId: string): Promise<number> {
  const [{ count }] = await prisma.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM "DocumentChunk"
    WHERE "documentId" = ${documentId} AND embedding IS NOT NULL
  `;
  return count;
}

beforeAll(async () => {
  uploadRoot = await mkdtemp(path.join(tmpdir(), "documind-processing-"));
  process.env.UPLOAD_DIR = uploadRoot;
  const runId = randomUUID();
  ownerId = (await prisma.user.create({ data: { email: `owner-${runId}@test.local` } })).id;
  otherUserId = (await prisma.user.create({ data: { email: `other-${runId}@test.local` } })).id;
});

beforeEach(async () => {
  await prisma.document.deleteMany({ where: { userId: ownerId } });
  generateEmbeddings.mockReset().mockImplementation(async (texts) => texts.map(fakeEmbedding));
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherUserId] } } });
  await prisma.$disconnect();
  await rm(uploadRoot, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
});

describe("claimDocumentForProcessing", () => {
  it("claims an uploaded document and marks it PROCESSING", async () => {
    const id = await createDocument(null);
    expect(await claimDocumentForProcessing(id, ownerId)).toBe("claimed");
    expect((await findDocument(id)).status).toBe("PROCESSING");
  });

  it("lets a failed document be retried, clearing the old error", async () => {
    const id = await createDocument(null, "ERROR");
    await prisma.document.update({ where: { id }, data: { errorMessage: "old failure" } });

    expect(await claimDocumentForProcessing(id, ownerId)).toBe("claimed");
    expect(await findDocument(id)).toMatchObject({ status: "PROCESSING", errorMessage: null });
  });

  it.each<DocumentStatus>(["PROCESSING", "EMBEDDING", "READY"])(
    "reports %s documents as busy without changing them",
    async (status) => {
      const id = await createDocument(null, status);
      expect(await claimDocumentForProcessing(id, ownerId)).toBe("busy");
      expect((await findDocument(id)).status).toBe(status);
    },
  );

  it("only lets one of two concurrent claims win", async () => {
    const id = await createDocument(null);
    const results = await Promise.all([
      claimDocumentForProcessing(id, ownerId),
      claimDocumentForProcessing(id, ownerId),
    ]);
    expect(results.sort()).toEqual(["busy", "claimed"]);
  });

  it("treats another user's document as not found", async () => {
    const id = await createDocument(null);
    expect(await claimDocumentForProcessing(id, otherUserId)).toBe("not_found");
    expect((await findDocument(id)).status).toBe("UPLOADING");
  });

  it("reports unknown IDs as not found", async () => {
    expect(await claimDocumentForProcessing(randomUUID(), ownerId)).toBe("not_found");
  });
});

describe("runProcessing", () => {
  it("extracts, chunks and embeds the text, then marks the document READY", async () => {
    const id = await createDocument(makePdf(["Page one", "Page two", "Page three"]));
    await claimDocumentForProcessing(id, ownerId);

    await runProcessing(id);

    expect(await findDocument(id)).toMatchObject({
      status: "READY",
      pageCount: 3,
      totalChunks: 1,
      embeddedChunks: 1,
      errorMessage: null,
    });
    expect(await findChunks(id)).toEqual([
      {
        chunkIndex: 0,
        content: "Page one\n\nPage two\n\nPage three",
        pageNumber: 1,
        tokenCount: 8,
      },
    ]);
    expect(await countEmbedded(id)).toBe(1);
  });

  it("records embedding failures as ERROR with a generic message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const apiError = new Error("429 Rate limit reached");
    generateEmbeddings.mockRejectedValueOnce(apiError);
    const id = await createDocument(makePdf(["Some text"]));

    await runProcessing(id);

    expect(await findDocument(id)).toMatchObject({
      status: "ERROR",
      errorMessage: "Processing failed. Please try again.",
      totalChunks: 1,
      embeddedChunks: 0,
    });
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(id), apiError);
    consoleError.mockRestore();
  });

  it("stores long documents as many ordered chunks with their page numbers", async () => {
    // ~2,400 characters per page over 40 lines, so each page needs two chunks
    const pageText = (n: number) =>
      Array.from({ length: 40 }, (_, line) =>
        [0, 1].map((i) => `Page ${n} sentence ${line * 2 + i} has words.`).join(" "),
      ).join("\n");
    const id = await createDocument(makePdf([pageText(1), pageText(2), pageText(3)]));

    await runProcessing(id);

    const document = await findDocument(id);
    const chunks = await findChunks(id);
    expect(document.status).toBe("READY");
    expect(chunks.length).toBeGreaterThan(3);
    expect(document.totalChunks).toBe(chunks.length);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    for (const chunk of chunks) {
      // A chunk's own text starts on its page; overlap may repeat the previous page's end
      expect(chunk.content).toContain(`Page ${chunk.pageNumber} sentence`);
    }
    expect(new Set(chunks.map((c) => c.pageNumber))).toEqual(new Set([1, 2, 3]));
  });

  it("stores more chunks than fit in one INSERT's bind parameters", async () => {
    // Postgres allows 65,535 bind parameters per statement; at 5 per chunk
    // row, 15,000 chunks only succeed if Prisma batches the insert
    const id = await createDocument(null);
    const text = Array.from({ length: 15_000 }, (_, i) => `Sentence ${i}.`).join("\n\n");
    const chunks = chunkPages([{ pageNumber: 1, text }], { chunkSize: 20, chunkOverlap: 0 });
    expect(chunks.length).toBe(15_000);

    await prisma.documentChunk.createMany({
      data: chunks.map((chunk) => ({ ...chunk, documentId: id })),
    });
    expect(await prisma.documentChunk.count({ where: { documentId: id } })).toBe(15_000);
  });

  it("replaces the chunks from an earlier attempt on retry", async () => {
    const id = await createDocument(makePdf(["Fresh text"]), "ERROR");
    await prisma.documentChunk.createMany({
      data: [0, 1].map((chunkIndex) => ({ documentId: id, chunkIndex, content: "stale" })),
    });

    await claimDocumentForProcessing(id, ownerId);
    await runProcessing(id);

    expect(await findDocument(id)).toMatchObject({
      status: "READY",
      totalChunks: 1,
      embeddedChunks: 1,
    });
    expect((await findChunks(id)).map((c) => c.content)).toEqual(["Fresh text"]);
  });

  it("marks image-only PDFs as ERROR with an explanation", async () => {
    const id = await createDocument(makePdf([null, null]));
    await runProcessing(id);
    expect(await findDocument(id)).toMatchObject({ status: "ERROR", errorMessage: NO_TEXT_MESSAGE });
  });

  it("marks damaged PDFs as ERROR with a user-facing message", async () => {
    const id = await createDocument(new TextEncoder().encode("%PDF-1.4\nnot really a pdf"));
    await runProcessing(id);
    const document = await findDocument(id);
    expect(document.status).toBe("ERROR");
    expect(document.errorMessage).toMatch(/may be damaged/);
  });

  it("logs unexpected failures and shows a generic message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await createDocument(null); // row exists, file doesn't

    await runProcessing(id);

    expect(await findDocument(id)).toMatchObject({
      status: "ERROR",
      errorMessage: "Processing failed. Please try again.",
    });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(id),
      expect.objectContaining({ code: "ENOENT" }),
    );
    consoleError.mockRestore();
  });

  it("never throws, even if the document has been deleted", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runProcessing(randomUUID())).resolves.toBeUndefined();
    consoleError.mockRestore();
  });
});
