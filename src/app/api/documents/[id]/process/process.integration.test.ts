import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Session } from "next-auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { documentStorageKey, saveFile } from "@/lib/documents/storage";
import { fakeEmbedding } from "@/test/embeddings";
import { makePdf } from "@/test/pdf";

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

const { POST } = await import("./route");

let uploadRoot: string;
let ownerId: string;
let otherUserId: string;

function signInAs(userId: string | null) {
  getSession.mockResolvedValue(
    userId ? { user: { id: userId }, expires: "2099-01-01T00:00:00.000Z" } : null,
  );
}

const callProcess = (id: string) =>
  POST(new Request(`http://localhost/api/documents/${id}/process`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });

async function createDocument(status: DocumentStatus): Promise<string> {
  const id = randomUUID();
  const filePath = documentStorageKey(ownerId, id);
  await saveFile(filePath, makePdf(["Retry me"]));
  await prisma.document.create({
    data: { id, title: "t", fileName: "t.pdf", fileSize: 1, filePath, status, userId: ownerId },
  });
  return id;
}

beforeAll(async () => {
  uploadRoot = await mkdtemp(path.join(tmpdir(), "documind-process-route-"));
  process.env.UPLOAD_DIR = uploadRoot;
  const runId = randomUUID();
  ownerId = (await prisma.user.create({ data: { email: `owner-${runId}@test.local` } })).id;
  otherUserId = (await prisma.user.create({ data: { email: `other-${runId}@test.local` } })).id;
});

beforeEach(() => {
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

describe("POST /api/documents/:id/process", () => {
  it("rejects signed-out requests", async () => {
    signInAs(null);
    expect((await callProcess(randomUUID())).status).toBe(401);
  });

  it("retries a failed document in the background", async () => {
    const id = await createDocument("ERROR");

    const response = await callProcess(id);

    expect(response.status).toBe(202);
    expect((await prisma.document.findUniqueOrThrow({ where: { id } })).status).toBe("PROCESSING");
    expect(scheduled).toHaveLength(1);

    await scheduled[0]();
    expect(await prisma.document.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "READY",
      pageCount: 1,
    });
  });

  it("returns 409 for a document that's already processing", async () => {
    const id = await createDocument("PROCESSING");
    const response = await callProcess(id);
    expect(response.status).toBe(409);
    expect(scheduled).toHaveLength(0);
  });

  it("returns 404 for another user's document", async () => {
    const id = await createDocument("ERROR");
    signInAs(otherUserId);

    const response = await callProcess(id);

    expect(response.status).toBe(404);
    expect((await prisma.document.findUniqueOrThrow({ where: { id } })).status).toBe("ERROR");
    expect(scheduled).toHaveLength(0);
  });
});
