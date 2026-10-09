import { randomUUID } from "node:crypto";
import type { Session } from "next-auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import type { ConversationDetail, ConversationSummary } from "@/types";

const getSession = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/lib/auth", () => ({ getSession }));

const list = await import("./route");
const item = await import("./[id]/route");

let ownerId: string;
let otherUserId: string;

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
  const { id } = await prisma.conversation.create({ data: { userId, documentIds } });
  if (updatedAt) {
    // @updatedAt is set by Prisma on every write, so pin it with raw SQL
    await prisma.$executeRaw`UPDATE "Conversation" SET "updatedAt" = ${updatedAt} WHERE id = ${id}`;
  }
  return id;
}

beforeAll(async () => {
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
        { conversationId: id, role: "assistant", content: "Hello!", createdAt: new Date("2026-01-01T10:01Z") },
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
      { id: expect.any(String), role: "user", content: "Hi", createdAt: "2026-01-01T10:00:00.000Z" },
      {
        id: expect.any(String),
        role: "assistant",
        content: "Hello!",
        createdAt: "2026-01-01T10:01:00.000Z",
      },
    ]);
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

describe("DELETE /api/chat/conversations/:id", () => {
  it("deletes the conversation and its messages", async () => {
    const id = await createConversationRow(ownerId, []);
    await prisma.message.create({ data: { conversationId: id, role: "user", content: "Hi" } });

    const response = await deleteOne(id);

    expect(response.status).toBe(204);
    expect(await prisma.conversation.count({ where: { id } })).toBe(0);
    expect(await prisma.message.count({ where: { conversationId: id } })).toBe(0);
  });

  it("can't delete another user's conversation", async () => {
    const id = await createConversationRow(otherUserId, []);
    expect((await deleteOne(id)).status).toBe(404);
    expect(await prisma.conversation.count({ where: { id } })).toBe(1);
  });

  it("requires sign-in", async () => {
    signInAs(null);
    expect((await deleteOne(randomUUID())).status).toBe(401);
  });
});
