import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Session } from "next-auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { deleteFile, imageStorageKey, saveFile } from "@/lib/storage";

const getSession = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/lib/auth", () => ({ getSession }));

const { GET } = await import("./route");

let ownerId: string;
let otherUserId: string;
let uploadRoot: string;

const IMAGE_BYTES = Buffer.from("not really a png, but the route only serves bytes");

function signInAs(userId: string | null) {
  getSession.mockResolvedValue(userId ? { user: { id: userId }, expires: "2099-01-01T00:00:00.000Z" } : null);
}

function get(id: string, headers: HeadersInit = {}) {
  return GET(new Request(`http://localhost/api/attachments/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

/** An image attached to a message in a conversation of `userId`'s, with its file stored */
async function createAttachment(userId: string) {
  const conversation = await prisma.conversation.create({ data: { userId, documentIds: [] } });
  const id = randomUUID();
  const storageKey = imageStorageKey(userId, id, "png");
  await saveFile(storageKey, IMAGE_BYTES);
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "user",
      content: "",
      attachments: {
        create: {
          id,
          position: 1,
          fileName: "Q3 chart.png",
          mediaType: "image/png",
          storageKey,
          width: 10,
          height: 10,
          byteSize: IMAGE_BYTES.byteLength,
        },
      },
    },
  });
  return { id, storageKey };
}

beforeAll(async () => {
  uploadRoot = await mkdtemp(path.join(tmpdir(), "documind-attachments-"));
  process.env.UPLOAD_DIR = uploadRoot;
  const runId = randomUUID();
  ownerId = (await prisma.user.create({ data: { email: `owner-${runId}@test.local` } })).id;
  otherUserId = (await prisma.user.create({ data: { email: `other-${runId}@test.local` } })).id;
});

beforeEach(async () => {
  await prisma.conversation.deleteMany({ where: { userId: { in: [ownerId, otherUserId] } } });
  signInAs(ownerId);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherUserId] } } });
  await prisma.$disconnect();
  await rm(uploadRoot, { recursive: true, force: true });
});

describe("GET /api/attachments/:id", () => {
  it("serves the image to the user who sent it, as its stored type", async () => {
    const { id } = await createAttachment(ownerId);

    const response = await get(id);

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(IMAGE_BYTES);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "image/png",
      "content-length": String(IMAGE_BYTES.byteLength),
      "content-disposition": `inline; filename="Q3 chart.png"; filename*=UTF-8''Q3%20chart.png`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-cache",
      etag: `"${id}"`,
    });
  });

  it("answers 304 when the browser already has it", async () => {
    const { id } = await createAttachment(ownerId);

    const response = await get(id, { "if-none-match": `"${id}"` });

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });

  it("treats another user's image like one that doesn't exist", async () => {
    const { id } = await createAttachment(otherUserId);

    for (const response of [await get(id), await get(randomUUID())]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Image not found." });
    }
  });

  it("reports a missing file without exposing where it was", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { id, storageKey } = await createAttachment(ownerId);
    await deleteFile(storageKey);

    const response = await get(id);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "The file for this image is missing." });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("requires sign-in", async () => {
    signInAs(null);
    expect((await get(randomUUID())).status).toBe(401);
  });
});
