import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Session } from "next-auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { MAX_FILE_SIZE } from "@/lib/documents/validation";
import { fakeEmbedding } from "@/test/embeddings";
import { makePdf } from "@/test/pdf";
import type { DocumentSummary } from "@/types";

// Replace the real session lookup (which needs a request cookie) with one the
// tests control. Everything else — Prisma, the filesystem — is real.
const getSession = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/lib/auth", () => ({ getSession }));

// The pipeline ends with embedding; fake it rather than calling the API
const generateEmbeddings = vi.hoisted(() => vi.fn<(texts: string[]) => Promise<number[][]>>());
vi.mock("@/lib/ai/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/embeddings")>()),
  generateEmbeddings,
}));

// after() needs a live Next.js request; collect the callbacks so tests can run them
const scheduled = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => unknown) => scheduled.push(callback),
}));

const { GET, POST } = await import("./route");

const PDF_BYTES = makePdf(["Hello from page one", "And page two"]);

function signInAs(userId: string | null) {
  getSession.mockResolvedValue(
    userId ? { user: { id: userId, name: "Test" }, expires: "2099-01-01T00:00:00.000Z" } : null,
  );
}

/** Builds a real multipart request, with the Content-Length a browser would send. */
async function uploadRequest(
  file: Blob | null,
  fileName = "Test Report.pdf",
  headers: Record<string, string> = {},
): Promise<Request> {
  const form = new FormData();
  if (file) form.append("file", file, fileName);
  const encoded = new Response(form);
  const body = new Uint8Array(await encoded.arrayBuffer());
  return new Request("http://localhost/api/documents", {
    method: "POST",
    body,
    headers: {
      "content-type": encoded.headers.get("content-type")!,
      "content-length": String(body.byteLength),
      ...headers,
    },
  });
}

async function storedFiles(): Promise<string[]> {
  const entries = await readdir(uploadRoot, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}

let uploadRoot: string;
let ownerId: string;
let otherUserId: string;

beforeAll(async () => {
  uploadRoot = await mkdtemp(path.join(tmpdir(), "documind-uploads-"));
  process.env.UPLOAD_DIR = uploadRoot;
  const runId = randomUUID();
  ownerId = (await prisma.user.create({ data: { email: `owner-${runId}@test.local` } })).id;
  otherUserId = (await prisma.user.create({ data: { email: `other-${runId}@test.local` } })).id;
});

beforeEach(async () => {
  await prisma.document.deleteMany({ where: { userId: { in: [ownerId, otherUserId] } } });
  await rm(uploadRoot, { recursive: true, force: true });
  scheduled.length = 0;
  generateEmbeddings.mockReset().mockImplementation(async (texts) => texts.map(fakeEmbedding));
  signInAs(ownerId);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherUserId] } } });
  await prisma.$disconnect();
  await rm(uploadRoot, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
});

describe("POST /api/documents", () => {
  it("rejects signed-out requests", async () => {
    signInAs(null);
    const response = await POST(await uploadRequest(new Blob([PDF_BYTES])));
    expect(response.status).toBe(401);
  });

  it("stores the PDF on disk and creates an UPLOADING document", async () => {
    const response = await POST(await uploadRequest(new Blob([PDF_BYTES]), "Test Report.pdf"));
    expect(response.status).toBe(201);

    const { document } = (await response.json()) as { document: DocumentSummary };
    expect(document).toMatchObject({
      title: "Test Report",
      fileName: "Test Report.pdf",
      fileSize: PDF_BYTES.byteLength,
      status: "UPLOADING",
      pageCount: null,
    });
    // Internal fields stay internal
    expect(document).not.toHaveProperty("filePath");
    expect(document).not.toHaveProperty("userId");

    const row = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(row.userId).toBe(ownerId);
    expect(row.filePath).toBe(`${ownerId}/${document.id}.pdf`);

    const saved = await readFile(path.join(uploadRoot, ownerId, `${document.id}.pdf`));
    expect(new Uint8Array(saved)).toEqual(PDF_BYTES);
  });

  it("starts processing after responding", async () => {
    const response = await POST(await uploadRequest(new Blob([PDF_BYTES])));
    const { document } = (await response.json()) as { document: DocumentSummary };
    expect(scheduled).toHaveLength(1);

    await scheduled[0]();

    expect(await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).toMatchObject({
      status: "READY",
      pageCount: 2,
    });
  });

  it("ignores directory parts in the uploaded file name", async () => {
    const response = await POST(await uploadRequest(new Blob([PDF_BYTES]), "../../evil.pdf"));
    expect(response.status).toBe(201);
    const { document } = (await response.json()) as { document: DocumentSummary };
    expect(document.fileName).toBe("evil.pdf");
    expect(await storedFiles()).toEqual([`${document.id}.pdf`]);
  });

  it("rejects files that aren't really PDFs, whatever their name", async () => {
    const fake = new Blob(["MZ this is an executable"], { type: "application/pdf" });
    const response = await POST(await uploadRequest(fake, "invoice.pdf"));
    expect(response.status).toBe(415);
    expect(scheduled).toHaveLength(0);
    expect(await response.json()).toEqual({ error: "Only PDF files are supported." });
    expect(await prisma.document.count({ where: { userId: ownerId } })).toBe(0);
    await expect(storedFiles()).rejects.toThrow(); // upload root never created
  });

  it("rejects a missing or empty file", async () => {
    expect((await POST(await uploadRequest(null))).status).toBe(400);
    expect((await POST(await uploadRequest(new Blob([])))).status).toBe(400);
  });

  it("rejects oversized requests from Content-Length before reading the body", async () => {
    const request = await uploadRequest(new Blob([PDF_BYTES]), "big.pdf", {
      "content-length": String(MAX_FILE_SIZE * 2),
    });
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(request.bodyUsed).toBe(false);
  });

  it("rejects a file over 10 MB even when the request fits the overhead allowance", async () => {
    const big = new Uint8Array(MAX_FILE_SIZE + 1);
    big.set(PDF_BYTES);
    const response = await POST(await uploadRequest(new Blob([big])));
    expect(response.status).toBe(413);
  });

  it("requires a Content-Length header", async () => {
    const request = await uploadRequest(new Blob([PDF_BYTES]));
    request.headers.delete("content-length");
    expect((await POST(request)).status).toBe(411);
  });

  it("removes the saved file if the database insert fails", async () => {
    // A session for a user that doesn't exist makes the foreign key fail
    signInAs(`missing-${randomUUID()}`);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(await uploadRequest(new Blob([PDF_BYTES])));

    expect(response.status).toBe(500);
    expect(await storedFiles()).toEqual([]);
    expect(scheduled).toHaveLength(0);
    vi.mocked(console.error).mockRestore();
  });
});

describe("GET /api/documents", () => {
  it("rejects signed-out requests", async () => {
    signInAs(null);
    expect((await GET()).status).toBe(401);
  });

  it("returns only the signed-in user's documents, newest first", async () => {
    const docFields = { fileName: "x.pdf", fileSize: 1, filePath: "x/x.pdf" };
    await prisma.document.create({
      data: { ...docFields, title: "Older", userId: ownerId, createdAt: new Date("2026-01-01") },
    });
    await prisma.document.create({
      data: { ...docFields, title: "Newer", userId: ownerId, createdAt: new Date("2026-02-01") },
    });
    await prisma.document.create({ data: { ...docFields, title: "Not mine", userId: otherUserId } });

    const response = await GET();
    expect(response.status).toBe(200);
    const { documents } = (await response.json()) as { documents: DocumentSummary[] };

    expect(documents.map((d) => d.title)).toEqual(["Newer", "Older"]);
    expect(documents[0].createdAt).toBe("2026-02-01T00:00:00.000Z");
    expect(documents[0]).not.toHaveProperty("filePath");
  });
});
