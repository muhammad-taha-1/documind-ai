import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { makePdf } from "@/test/pdf";
import { claimDocumentForProcessing, NO_TEXT_MESSAGE, runProcessing } from "./processing";
import { documentStorageKey, saveFile } from "./storage";

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

beforeAll(async () => {
  uploadRoot = await mkdtemp(path.join(tmpdir(), "documind-processing-"));
  process.env.UPLOAD_DIR = uploadRoot;
  const runId = randomUUID();
  ownerId = (await prisma.user.create({ data: { email: `owner-${runId}@test.local` } })).id;
  otherUserId = (await prisma.user.create({ data: { email: `other-${runId}@test.local` } })).id;
});

beforeEach(async () => {
  await prisma.document.deleteMany({ where: { userId: ownerId } });
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
  it("extracts text and records the page count", async () => {
    const id = await createDocument(makePdf(["Page one", "Page two", "Page three"]));
    await claimDocumentForProcessing(id, ownerId);

    await runProcessing(id);

    // Chunking (Phase 6) picks up from here, so the status stays PROCESSING
    expect(await findDocument(id)).toMatchObject({
      status: "PROCESSING",
      pageCount: 3,
      errorMessage: null,
    });
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
