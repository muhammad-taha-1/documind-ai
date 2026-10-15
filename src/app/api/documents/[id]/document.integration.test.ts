import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Session } from "next-auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { claimDocumentForProcessing, runProcessing } from "@/lib/documents/processing";
import { documentStorageKey, resolveStorageKey, saveFile } from "@/lib/storage";
import { makePdf } from "@/test/pdf";

const getSession = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/lib/auth", () => ({ getSession }));

const item = await import("./route");
const file = await import("./file/route");

const PDF_BYTES = makePdf(["Hello from page one"]);

let uploadRoot: string;
let ownerId: string;
let otherUserId: string;

function signInAs(userId: string | null) {
  getSession.mockResolvedValue(userId ? { user: { id: userId }, expires: "2099-01-01T00:00:00.000Z" } : null);
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });
const deleteOne = (id: string) =>
  item.DELETE(new Request(`http://localhost/api/documents/${id}`, { method: "DELETE" }), context(id));
const getFile = (id: string) => file.GET(new Request(`http://localhost/api/documents/${id}/file`), context(id));

/** A READY document with a stored PDF and two chunks */
async function createDocument(userId: string, fileName = "Report.pdf") {
  const id = randomUUID();
  const filePath = documentStorageKey(userId, id);
  await saveFile(filePath, PDF_BYTES);
  await prisma.document.create({
    data: {
      id,
      title: "Report",
      fileName,
      fileSize: PDF_BYTES.byteLength,
      filePath,
      status: "READY",
      userId,
      chunks: {
        create: [
          { content: "First passage", pageNumber: 1, chunkIndex: 0 },
          { content: "Second passage", pageNumber: 1, chunkIndex: 1 },
        ],
      },
    },
  });
  return { id, absolutePath: resolveStorageKey(filePath) };
}

function fileExists(absolutePath: string): Promise<boolean> {
  return access(absolutePath).then(
    () => true,
    () => false,
  );
}

beforeAll(async () => {
  uploadRoot = await mkdtemp(path.join(tmpdir(), "documind-uploads-"));
  process.env.UPLOAD_DIR = uploadRoot;
  const runId = randomUUID();
  ownerId = (await prisma.user.create({ data: { email: `owner-${runId}@test.local` } })).id;
  otherUserId = (await prisma.user.create({ data: { email: `other-${runId}@test.local` } })).id;
});

beforeEach(async () => {
  const users = { userId: { in: [ownerId, otherUserId] } };
  await prisma.conversation.deleteMany({ where: users });
  await prisma.document.deleteMany({ where: users });
  await rm(uploadRoot, { recursive: true, force: true });
  signInAs(ownerId);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherUserId] } } });
  await prisma.$disconnect();
  await rm(uploadRoot, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
});

describe("DELETE /api/documents/:id", () => {
  it("deletes the document, its passages and its file", async () => {
    const document = await createDocument(ownerId);
    const kept = await createDocument(ownerId);

    const response = await deleteOne(document.id);

    expect(response.status).toBe(204);
    expect(await prisma.document.count({ where: { id: document.id } })).toBe(0);
    expect(await prisma.documentChunk.count({ where: { documentId: document.id } })).toBe(0);
    expect(await fileExists(document.absolutePath)).toBe(false);
    // Nothing else is touched
    expect(await prisma.documentChunk.count({ where: { documentId: kept.id } })).toBe(2);
    expect(await fileExists(kept.absolutePath)).toBe(true);
  });

  it("removes it from the user's chats without counting as chat activity", async () => {
    const document = await createDocument(ownerId);
    const other = await createDocument(ownerId);
    const updatedAt = new Date("2026-01-01T00:00:00Z");
    const both = await prisma.conversation.create({
      data: { userId: ownerId, documentIds: [other.id, document.id], updatedAt },
    });
    const only = await prisma.conversation.create({
      data: { userId: ownerId, documentIds: [document.id], updatedAt },
    });
    const unrelated = await prisma.conversation.create({
      data: { userId: ownerId, documentIds: [other.id], updatedAt },
    });

    expect((await deleteOne(document.id)).status).toBe(204);

    const rows = await prisma.conversation.findMany({
      where: { id: { in: [both.id, only.id, unrelated.id] } },
      select: { id: true, documentIds: true, updatedAt: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    // The chats themselves stay
    expect(byId.get(both.id)?.documentIds).toEqual([other.id]);
    expect(byId.get(only.id)?.documentIds).toEqual([]);
    expect(byId.get(unrelated.id)?.documentIds).toEqual([other.id]);
    for (const row of rows) {
      expect(row.updatedAt).toEqual(updatedAt);
    }
  });

  it("keeps replies that cited it, without those sources", async () => {
    const document = await createDocument(ownerId);
    const other = await createDocument(ownerId);
    const [cited] = await prisma.documentChunk.findMany({ where: { documentId: document.id } });
    const [stillThere] = await prisma.documentChunk.findMany({ where: { documentId: other.id } });
    const conversation = await prisma.conversation.create({
      data: { userId: ownerId, documentIds: [document.id, other.id] },
    });
    const reply = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: "See [Source 1] and [Source 2].",
        retrieval: "MATCHED",
        sources: {
          create: [
            { position: 1, chunkId: cited.id, similarity: 0.5 },
            { position: 2, chunkId: stillThere.id, similarity: 0.4 },
          ],
        },
      },
    });

    expect((await deleteOne(document.id)).status).toBe(204);

    const saved = await prisma.message.findUniqueOrThrow({
      where: { id: reply.id },
      select: { content: true, sources: { select: { position: true } } },
    });
    expect(saved.content).toBe("See [Source 1] and [Source 2].");
    expect(saved.sources).toEqual([{ position: 2 }]);
  });

  it("still deletes the document if its file is already gone", async () => {
    const document = await createDocument(ownerId);
    await rm(document.absolutePath);

    expect((await deleteOne(document.id)).status).toBe(204);
    expect(await prisma.document.count({ where: { id: document.id } })).toBe(0);
  });

  it("can't delete another user's document", async () => {
    const document = await createDocument(otherUserId);

    const response = await deleteOne(document.id);

    expect(response.status).toBe(404);
    expect(await prisma.document.count({ where: { id: document.id } })).toBe(1);
    expect(await fileExists(document.absolutePath)).toBe(true);
  });

  it("returns 404 for unknown IDs", async () => {
    expect((await deleteOne(randomUUID())).status).toBe(404);
  });

  it("requires sign-in", async () => {
    const document = await createDocument(ownerId);
    signInAs(null);
    expect((await deleteOne(document.id)).status).toBe(401);
    expect(await prisma.document.count({ where: { id: document.id } })).toBe(1);
  });

  it("stops processing quietly when the document is deleted mid-run", async () => {
    const document = await createDocument(ownerId);
    await prisma.document.update({ where: { id: document.id }, data: { status: "ERROR" } });
    expect(await claimDocumentForProcessing(document.id, ownerId)).toBe("claimed");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    // Deleted after the pipeline found the document, before it read the file
    const read = vi.spyOn(prisma.document, "findUniqueOrThrow");
    read.mockImplementationOnce((async () => {
      const row = { filePath: documentStorageKey(ownerId, document.id) };
      expect((await deleteOne(document.id)).status).toBe(204);
      return row;
    }) as never);
    await runProcessing(document.id);

    expect(error).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(`Document ${document.id} was deleted while being processed`);
    read.mockRestore();
    error.mockRestore();
    info.mockRestore();
  });
});

describe("GET /api/documents/:id/file", () => {
  it("serves the PDF for the browser to show", async () => {
    const document = await createDocument(ownerId, "Résumé 2026.pdf");

    const response = await getFile(document.id);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-length")).toBe(String(PDF_BYTES.byteLength));
    expect(response.headers.get("content-disposition")).toBe(
      `inline; filename="R_sum_ 2026.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%202026.pdf`,
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it("returns 404 when the file is missing", async () => {
    const document = await createDocument(ownerId);
    await rm(document.absolutePath);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await getFile(document.id)).status).toBe(404);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("can't read another user's document", async () => {
    const document = await createDocument(otherUserId);
    expect((await getFile(document.id)).status).toBe(404);
  });

  it("requires sign-in", async () => {
    const document = await createDocument(ownerId);
    signInAs(null);
    expect((await getFile(document.id)).status).toBe(401);
  });
});
