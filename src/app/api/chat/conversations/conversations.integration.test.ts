import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Session } from "next-auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { imageStorageKey, resolveStorageKey, saveFile } from "@/lib/storage";
import type { ConversationDetail, ConversationSummary } from "@/types";

const getSession = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/lib/auth", () => ({ getSession }));

const list = await import("./route");
const item = await import("./[id]/route");

let ownerId: string;
let otherUserId: string;
let uploadRoot: string;

function signInAs(userId: string | null) {
  getSession.mockResolvedValue(
    userId ? { user: { id: userId }, expires: "2099-01-01T00:00:00.000Z" } : null,
  );
}

/** A JSON POST with the Content-Length a browser would send. */
function createRequest(body: unknown, rawBody = JSON.stringify(body)) {
  return list.POST(
    new Request("http://localhost/api/chat/conversations", {
      method: "POST",
      body: rawBody,
      headers: {
        "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(rawBody).byteLength),
      },
    }),
  );
}

const itemContext = (id: string) => ({ params: Promise.resolve({ id }) });
const getOne = (id: string) =>
  item.GET(new Request(`http://localhost/api/chat/conversations/${id}`), itemContext(id));
const patchOne = (id: string, body: unknown) => {
  const raw = JSON.stringify(body);
  return item.PATCH(
    new Request(`http://localhost/api/chat/conversations/${id}`, {
      method: "PATCH",
      body: raw,
      headers: {
        "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(raw).byteLength),
      },
    }),
    itemContext(id),
  );
};
const deleteOne = (id: string) =>
  item.DELETE(
    new Request(`http://localhost/api/chat/conversations/${id}`, { method: "DELETE" }),
    itemContext(id),
  );

async function createDocument(userId: string, title = "Doc"): Promise<string> {
  const document = await prisma.document.create({
    data: { title, fileName: "d.pdf", fileSize: 1, filePath: "unused", status: "READY", userId },
  });
  return document.id;
}

async function createConversationRow(userId: string, documentIds: string[], updatedAt?: Date) {
  const { id } = await prisma.conversation.create({ data: { userId, documentIds, updatedAt } });
  return id;
}

/** A user message with an image attached, its file stored. Returns the attachment's ID and storage key. */
async function createMessageWithImage(conversationId: string, userId: string) {
  const attachmentId = randomUUID();
  const storageKey = imageStorageKey(userId, attachmentId, "png");
  await saveFile(storageKey, Buffer.from("png bytes"));
  await prisma.message.create({
    data: {
      conversationId,
      role: "user",
      content: "",
      attachments: {
        create: {
          id: attachmentId,
          position: 1,
          fileName: "chart.png",
          mediaType: "image/png",
          storageKey,
          width: 640,
          height: 480,
          byteSize: 9,
        },
      },
    },
  });
  return { attachmentId, storageKey };
}

const fileExists = (key: string) =>
  access(resolveStorageKey(key)).then(
    () => true,
    () => false,
  );

beforeAll(async () => {
  uploadRoot = await mkdtemp(path.join(tmpdir(), "documind-conversations-"));
  process.env.UPLOAD_DIR = uploadRoot;
  const runId = randomUUID();
  ownerId = (await prisma.user.create({ data: { email: `owner-${runId}@test.local` } })).id;
  otherUserId = (await prisma.user.create({ data: { email: `other-${runId}@test.local` } })).id;
});

beforeEach(async () => {
  const users = { userId: { in: [ownerId, otherUserId] } };
  await prisma.conversation.deleteMany({ where: users });
  await prisma.document.deleteMany({ where: users });
  signInAs(ownerId);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherUserId] } } });
  await prisma.$disconnect();
  await rm(uploadRoot, { recursive: true, force: true });
});

describe("POST /api/chat/conversations", () => {
  it("starts a conversation about the user's documents", async () => {
    const documentIds = [await createDocument(ownerId), await createDocument(ownerId)];

    const response = await createRequest({ documentIds });

    expect(response.status).toBe(201);
    const { conversation } = (await response.json()) as { conversation: ConversationSummary };
    expect(conversation).toEqual({
      id: expect.any(String),
      title: "New Chat",
      updatedAt: expect.any(String),
    });
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(row).toMatchObject({ userId: ownerId, documentIds });
  });

  it("ignores duplicate document IDs", async () => {
    const documentId = await createDocument(ownerId);
    const response = await createRequest({ documentIds: [documentId, documentId] });

    expect(response.status).toBe(201);
    const { conversation } = (await response.json()) as { conversation: ConversationSummary };
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(row.documentIds).toEqual([documentId]);
  });

  it("refuses another user's document, even alongside the user's own", async () => {
    const mine = await createDocument(ownerId);
    const theirs = await createDocument(otherUserId);

    const response = await createRequest({ documentIds: [mine, theirs] });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "One or more documents were not found." });
    expect(await prisma.conversation.count({ where: { userId: ownerId } })).toBe(0);
  });

  it("refuses document IDs that don't exist", async () => {
    const response = await createRequest({ documentIds: [randomUUID()] });
    expect(response.status).toBe(403);
  });

  it.each([
    [{ documentIds: [] }, "documentIds: Select at least one document."],
    [{ documentIds: "abc" }, "documentIds: Invalid input: expected array, received string"],
    [{}, "documentIds: Invalid input: expected array, received undefined"],
    [
      { documentIds: Array.from({ length: 21 }, (_, i) => `doc-${i}`) },
      "documentIds: You can chat with up to 20 documents at once.",
    ],
  ])("rejects an invalid body %j", async (body, error) => {
    const response = await createRequest(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
  });

  it("rejects malformed JSON", async () => {
    const response = await createRequest(null, "{not json");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Request body must be valid JSON." });
  });

  it("rejects oversized bodies before reading them", async () => {
    const response = await createRequest(null, JSON.stringify({ documentIds: ["x".repeat(20_000)] }));
    expect(response.status).toBe(413);
  });

  it("requires sign-in", async () => {
    signInAs(null);
    expect((await createRequest({ documentIds: ["x"] })).status).toBe(401);
  });
});

describe("GET /api/chat/conversations", () => {
  it("lists only the user's conversations, most recently active first", async () => {
    const older = await createConversationRow(ownerId, [], new Date("2026-01-01"));
    const newer = await createConversationRow(ownerId, [], new Date("2026-02-01"));
    await createConversationRow(otherUserId, []);

    const response = await list.GET();

    expect(response.status).toBe(200);
    const { conversations } = (await response.json()) as { conversations: ConversationSummary[] };
    expect(conversations.map((c) => c.id)).toEqual([newer, older]);
    expect(conversations[0]).toEqual({
      id: newer,
      title: "New Chat",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
  });

  it("requires sign-in", async () => {
    signInAs(null);
    expect((await list.GET()).status).toBe(401);
  });
});

describe("GET /api/chat/conversations/:id", () => {
  it("returns the conversation with its documents and messages in order", async () => {
    const first = await createDocument(ownerId, "First");
    const second = await createDocument(ownerId, "Second");
    const id = await createConversationRow(ownerId, [second, first]);
    await prisma.message.createMany({
      data: [
        { conversationId: id, role: "user", content: "Hi", createdAt: new Date("2026-01-01T10:00Z") },
        { conversationId: id, role: "system", content: "internal", createdAt: new Date("2026-01-01T10:00:30Z") },
        {
          conversationId: id,
          role: "assistant",
          content: "Hello!",
          createdAt: new Date("2026-01-01T10:01Z"),
          inputTokens: 12,
          outputTokens: 34,
          cacheReadTokens: 56,
          cacheWriteTokens: 78,
          contextTokens: 146,
        },
      ],
    });

    const response = await getOne(id);

    expect(response.status).toBe(200);
    const { conversation } = (await response.json()) as { conversation: ConversationDetail };
    // Documents keep the order they were picked in
    expect(conversation.documents).toEqual([
      { id: second, title: "Second", status: "READY" },
      { id: first, title: "First", status: "READY" },
    ]);
    // System messages aren't part of the visible chat
    expect(conversation.messages).toEqual([
      {
        id: expect.any(String),
        role: "user",
        content: "Hi",
        attachments: [],
        createdAt: "2026-01-01T10:00:00.000Z",
        retrieval: null,
        sources: [],
        toolCalls: [],
        usage: null,
      },
      {
        id: expect.any(String),
        role: "assistant",
        content: "Hello!",
        attachments: [],
        createdAt: "2026-01-01T10:01:00.000Z",
        retrieval: null,
        sources: [],
        toolCalls: [],
        usage: { inputTokens: 12, outputTokens: 34, cacheReadTokens: 56, cacheWriteTokens: 78 },
      },
    ]);
    expect(conversation.compaction).toBeNull();
  });

  it("returns each message's images, with where to load them from", async () => {
    const id = await createConversationRow(ownerId, []);
    const { attachmentId } = await createMessageWithImage(id, ownerId);

    const { conversation } = (await (await getOne(id)).json()) as { conversation: ConversationDetail };

    expect(conversation.messages[0]).toMatchObject({
      content: "",
      attachments: [
        {
          id: attachmentId,
          name: "chart.png",
          mediaType: "image/png",
          width: 640,
          height: 480,
          url: `/api/attachments/${attachmentId}`,
        },
      ],
    });
    // Where the file is stored stays on the server
    expect(JSON.stringify(conversation)).not.toContain("images/");
  });

  it("returns the tools each reply used, skipping a record that isn't valid", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await createConversationRow(ownerId, []);
    const call = {
      id: "toolu_1",
      name: "search_documents",
      input: { query: "pricing" },
      label: 'Searched your documents for "pricing"',
      status: "done",
      output: "[Source 1 — Doc]\nPrices",
    };
    await prisma.message.createMany({
      data: [
        { conversationId: id, role: "assistant", content: "A", toolCalls: [call], createdAt: new Date("2026-01-01T10:00Z") },
        // e.g. written by an older version of the app
        { conversationId: id, role: "assistant", content: "B", toolCalls: [{ tool: "x" }], createdAt: new Date("2026-01-01T10:01Z") },
      ],
    });

    const { conversation } = (await (await getOne(id)).json()) as { conversation: ConversationDetail };

    expect(conversation.messages.map((message) => message.toolCalls)).toEqual([[call], []]);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("malformed toolCalls"), expect.anything());
    consoleError.mockRestore();
  });

  it("returns each reply's sources by number, dropping those whose passage is gone", async () => {
    const documentId = await createDocument(ownerId, "Handbook");
    const chunk = (chunkIndex: number, pageNumber: number) =>
      prisma.documentChunk.create({
        data: { documentId, chunkIndex, pageNumber, content: `Passage ${chunkIndex}` },
      });
    const [first, second, third] = [await chunk(0, 1), await chunk(1, 2), await chunk(2, 3)];
    const id = await createConversationRow(ownerId, [documentId]);
    await prisma.message.create({
      data: {
        conversationId: id,
        role: "assistant",
        content: "See [Source 1] and [Source 3].",
        retrieval: "MATCHED",
        sources: {
          create: [
            { position: 3, chunkId: third.id, similarity: 0.31 },
            { position: 1, chunkId: first.id, similarity: 0.62 },
            { position: 2, chunkId: second.id, similarity: 0.45 },
          ],
        },
      },
    });
    // e.g. the document was reprocessed and this chunk replaced
    await prisma.documentChunk.delete({ where: { id: second.id } });

    const { conversation } = (await (await getOne(id)).json()) as { conversation: ConversationDetail };

    expect(conversation.messages[0]).toMatchObject({
      retrieval: "MATCHED",
      sources: [
        {
          position: 1,
          chunkId: first.id,
          documentId,
          documentTitle: "Handbook",
          pageNumber: 1,
          content: "Passage 0",
          similarity: 0.62,
        },
        // Numbers are kept, so "[Source 3]" still points at the right passage
        { position: 3, chunkId: third.id, content: "Passage 2", pageNumber: 3, similarity: 0.31 },
      ],
    });
  });

  it("leaves out documents deleted since the conversation started", async () => {
    const kept = await createDocument(ownerId, "Kept");
    const deleted = await createDocument(ownerId, "Deleted");
    const id = await createConversationRow(ownerId, [kept, deleted]);
    await prisma.document.delete({ where: { id: deleted } });

    const { conversation } = (await (await getOne(id)).json()) as { conversation: ConversationDetail };
    expect(conversation.documents.map((d) => d.title)).toEqual(["Kept"]);
  });

  it("treats another user's conversation as not found", async () => {
    const id = await createConversationRow(otherUserId, []);
    const response = await getOne(id);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Conversation not found." });
  });

  it("returns 404 for unknown IDs", async () => {
    expect((await getOne(randomUUID())).status).toBe(404);
  });

  it("requires sign-in", async () => {
    signInAs(null);
    expect((await getOne(randomUUID())).status).toBe(401);
  });
});

describe("PATCH /api/chat/conversations/:id", () => {
  const lastWeek = new Date("2026-01-01T00:00:00Z");

  it("renames a conversation without moving it up the list", async () => {
    const id = await createConversationRow(ownerId, [], lastWeek);

    const response = await patchOne(id, { title: "  Quarterly\n review  " });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { conversation: ConversationSummary };
    // Whitespace tidied; a rename isn't activity, so the time stays
    expect(body.conversation).toEqual({ id, title: "Quarterly review", updatedAt: lastWeek.toISOString() });
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id } })).title).toBe("Quarterly review");
  });

  it("replaces the documents, returning them in the new order", async () => {
    const first = await createDocument(ownerId, "First");
    const second = await createDocument(ownerId, "Second");
    const id = await createConversationRow(ownerId, [first], lastWeek);

    const response = await patchOne(id, { documentIds: [second, first, second] });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { documents: unknown };
    expect(body.documents).toEqual([
      { id: second, title: "Second", status: "READY" },
      { id: first, title: "First", status: "READY" },
    ]);
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    expect(row.documentIds).toEqual([second, first]);
    expect(row.updatedAt).toEqual(lastWeek);
  });

  it("refuses another user's document, changing nothing", async () => {
    const mine = await createDocument(ownerId);
    const theirs = await createDocument(otherUserId);
    const id = await createConversationRow(ownerId, [mine]);

    const response = await patchOne(id, { title: "New", documentIds: [mine, theirs] });

    expect(response.status).toBe(403);
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ title: "New Chat", documentIds: [mine] });
  });

  it.each([
    [{}, /Nothing to update/],
    [{ title: "   " }, /can't be empty/],
    [{ title: "x".repeat(101) }, /up to 100 characters/],
    [{ documentIds: [] }, /at least one document/],
  ])("rejects %j", async (body, message) => {
    const id = await createConversationRow(ownerId, []);
    const response = await patchOne(id, body);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(message);
  });

  it("can't change another user's conversation", async () => {
    const id = await createConversationRow(otherUserId, []);
    expect((await patchOne(id, { title: "Mine now" })).status).toBe(404);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id } })).title).toBe("New Chat");
  });

  it("requires sign-in", async () => {
    const id = await createConversationRow(ownerId, []);
    signInAs(null);
    expect((await patchOne(id, { title: "x" })).status).toBe(401);
  });
});

describe("DELETE /api/chat/conversations/:id", () => {
  it("deletes the conversation and its messages", async () => {
    const id = await createConversationRow(ownerId, []);
    await prisma.message.create({ data: { conversationId: id, role: "user", content: "Hi" } });

    const response = await deleteOne(id);

    expect(response.status).toBe(204);
    expect(await prisma.conversation.count({ where: { id } })).toBe(0);
    expect(await prisma.message.count({ where: { conversationId: id } })).toBe(0);
  });

  it("deletes the images attached to its messages, files included", async () => {
    const id = await createConversationRow(ownerId, []);
    const { attachmentId, storageKey } = await createMessageWithImage(id, ownerId);

    expect((await deleteOne(id)).status).toBe(204);

    expect(await prisma.messageAttachment.count({ where: { id: attachmentId } })).toBe(0);
    expect(await fileExists(storageKey)).toBe(false);
  });

  it("can't delete another user's conversation", async () => {
    const id = await createConversationRow(otherUserId, []);
    const { storageKey } = await createMessageWithImage(id, otherUserId);
    expect((await deleteOne(id)).status).toBe(404);
    expect(await prisma.conversation.count({ where: { id } })).toBe(1);
    expect(await fileExists(storageKey)).toBe(true);
  });

  it("requires sign-in", async () => {
    signInAs(null);
    expect((await deleteOne(randomUUID())).status).toBe(401);
  });
});
