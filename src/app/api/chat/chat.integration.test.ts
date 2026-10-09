import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { Session } from "next-auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatReply, ChatTurn } from "@/lib/ai/chat";
import { prisma } from "@/lib/db/prisma";
import { HISTORY_MESSAGE_LIMIT } from "@/lib/chat/queries";
import { readNdjson } from "@/lib/chat/stream";
import type { ChatStreamEvent } from "@/types";

const getSession = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/lib/auth", () => ({ getSession }));

// Claude is scripted per test; describeChatError stays real
type Generate = (
  turns: ChatTurn[],
  options: { onText: (text: string) => void; signal?: AbortSignal },
) => Promise<ChatReply>;
const generateChatReply = vi.hoisted(() => vi.fn<Generate>());
vi.mock("@/lib/ai/chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/chat")>()),
  generateChatReply,
}));

const { POST } = await import("./route");

let ownerId: string;
let otherUserId: string;

function signInAs(userId: string | null) {
  getSession.mockResolvedValue(
    userId ? { user: { id: userId }, expires: "2099-01-01T00:00:00.000Z" } : null,
  );
}

function chatRequest(body: unknown, signal?: AbortSignal) {
  const raw = JSON.stringify(body);
  return new Request("http://localhost/api/chat", {
    method: "POST",
    body: raw,
    signal,
    headers: {
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(raw).byteLength),
    },
  });
}

async function readEvents(response: Response): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of readNdjson(response.body!)) events.push(event as ChatStreamEvent);
  return events;
}

/** A reply that streams the given pieces of text. */
function replyWith(pieces: string[], overrides: Partial<ChatReply> = {}): Generate {
  return async (_turns, { onText }) => {
    pieces.forEach(onText);
    return {
      text: pieces.join(""),
      model: "claude-test",
      stopReason: "end_turn",
      tokensUsed: 42,
      ...overrides,
    };
  };
}

async function createConversation(userId: string) {
  const { id } = await prisma.conversation.create({ data: { userId, documentIds: [] } });
  return id;
}

const findMessages = (conversationId: string) =>
  prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  const runId = randomUUID();
  ownerId = (await prisma.user.create({ data: { email: `owner-${runId}@test.local` } })).id;
  otherUserId = (await prisma.user.create({ data: { email: `other-${runId}@test.local` } })).id;
});

beforeEach(async () => {
  await prisma.conversation.deleteMany({ where: { userId: { in: [ownerId, otherUserId] } } });
  generateChatReply.mockReset();
  signInAs(ownerId);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherUserId] } } });
  await prisma.$disconnect();
});

describe("POST /api/chat", () => {
  it("streams the reply, then saves both messages and names the chat", async () => {
    const id = await createConversation(ownerId);
    generateChatReply.mockImplementation(replyWith(["Hello", " there", "!"]));

    const response = await POST(chatRequest({ conversationId: id, message: "  Hi Claude  " }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    const events = await readEvents(response);
    expect(events.slice(0, 3)).toEqual([
      { type: "delta", text: "Hello" },
      { type: "delta", text: " there" },
      { type: "delta", text: "!" },
    ]);
    expect(events).toHaveLength(4);
    const done = events[3];
    expect(done).toMatchObject({
      type: "done",
      userMessage: { role: "user", content: "Hi Claude" },
      assistantMessage: { role: "assistant", content: "Hello there!" },
      conversation: { id, title: "Hi Claude" },
    });

    const saved = await findMessages(id);
    expect(saved.map((m) => [m.role, m.content, m.model, m.tokensUsed])).toEqual([
      ["user", "Hi Claude", null, null],
      ["assistant", "Hello there!", "claude-test", 42],
    ]);
    // The message is sent trimmed, as the only turn
    expect(generateChatReply.mock.calls[0][0]).toEqual([{ role: "user", content: "Hi Claude" }]);
  });

  it("sends earlier messages as history and keeps the title after the first exchange", async () => {
    const id = await createConversation(ownerId);
    generateChatReply.mockImplementation(replyWith(["First answer"]));
    await readEvents(await POST(chatRequest({ conversationId: id, message: "First question" })));
    const afterFirst = await prisma.conversation.findUniqueOrThrow({ where: { id } });

    generateChatReply.mockImplementation(replyWith(["Second answer"]));
    const events = await readEvents(
      await POST(chatRequest({ conversationId: id, message: "Second question" })),
    );

    expect(generateChatReply.mock.calls[1][0]).toEqual([
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second question" },
    ]);
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    expect(conversation.title).toBe("First question");
    // Each exchange moves the chat to the top of the sidebar
    expect(conversation.updatedAt.getTime()).toBeGreaterThan(afterFirst.updatedAt.getTime());
    expect(events.at(-1)).toMatchObject({ type: "done", conversation: { title: "First question" } });
  });

  it(`sends at most the last ${HISTORY_MESSAGE_LIMIT} messages, starting with a user turn`, async () => {
    const id = await createConversation(ownerId);
    const start = Date.now() - 60_000;
    // 25 messages alternating user/assistant, so the newest 20 open on an assistant reply
    await prisma.message.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        conversationId: id,
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `message ${i}`,
        createdAt: new Date(start + i * 1000),
      })),
    });
    generateChatReply.mockImplementation(replyWith(["ok"]));

    await readEvents(await POST(chatRequest({ conversationId: id, message: "latest" })));

    const turns = generateChatReply.mock.calls[0][0];
    expect(turns[0]).toEqual({ role: "user", content: "message 6" });
    expect(turns.at(-2)).toEqual({ role: "user", content: "message 24" });
    expect(turns.at(-1)).toEqual({ role: "user", content: "latest" });
    expect(turns).toHaveLength(HISTORY_MESSAGE_LIMIT);
  });

  it("saves nothing when Claude declines the request", async () => {
    const id = await createConversation(ownerId);
    generateChatReply.mockImplementation(replyWith(["Partial"], { stopReason: "refusal" }));

    const events = await readEvents(await POST(chatRequest({ conversationId: id, message: "Hi" })));

    expect(events.at(-1)).toEqual({ type: "error", error: expect.stringMatching(/can't help/) });
    expect(await findMessages(id)).toEqual([]);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id } })).title).toBe("New Chat");
  });

  it("saves nothing when the reply is empty", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await createConversation(ownerId);
    generateChatReply.mockImplementation(replyWith(["  "]));

    const events = await readEvents(await POST(chatRequest({ conversationId: id, message: "Hi" })));

    expect(events.at(-1)).toEqual({ type: "error", error: expect.stringMatching(/didn't return a reply/) });
    expect(await findMessages(id)).toEqual([]);
    consoleError.mockRestore();
  });

  it("reports API failures with a friendly message and saves nothing", async () => {
    const id = await createConversation(ownerId);
    generateChatReply.mockRejectedValue(
      new Anthropic.RateLimitError(429, undefined, "rate_limit_error: slow down", new Headers()),
    );

    const events = await readEvents(await POST(chatRequest({ conversationId: id, message: "Hi" })));

    expect(events).toEqual([
      {
        type: "error",
        error: "Claude is handling a lot of requests right now. Please try again in a moment.",
      },
    ]);
    expect(await findMessages(id)).toEqual([]);
  });

  it("logs unexpected failures without exposing them", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await createConversation(ownerId);
    generateChatReply.mockRejectedValue(new Error("secret internal detail"));

    const events = await readEvents(await POST(chatRequest({ conversationId: id, message: "Hi" })));

    expect(JSON.stringify(events)).not.toContain("secret");
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(id), expect.any(Error));
    consoleError.mockRestore();
  });

  it("stops generating and saves nothing when the browser disconnects", async () => {
    const id = await createConversation(ownerId);
    let generationSignal: AbortSignal | undefined;
    generateChatReply.mockImplementation(async (_turns, { onText, signal }) => {
      generationSignal = signal;
      onText("Partial");
      // Like the SDK: wait until aborted, then reject
      await new Promise((_resolve, reject) =>
        signal!.addEventListener("abort", () => reject(new Anthropic.APIUserAbortError())),
      );
      throw new Error("unreachable");
    });

    const response = await POST(chatRequest({ conversationId: id, message: "Hi" }));
    const reader = response.body!.getReader();
    await reader.read(); // the first delta
    await reader.cancel();

    await vi.waitFor(() => expect(generationSignal?.aborted).toBe(true));
    expect(await findMessages(id)).toEqual([]);
  });

  it("treats another user's conversation as not found, without calling Claude", async () => {
    const id = await createConversation(otherUserId);
    const response = await POST(chatRequest({ conversationId: id, message: "Hi" }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Conversation not found." });
    expect(generateChatReply).not.toHaveBeenCalled();
  });

  it.each([
    [{ conversationId: "x", message: "   " }, "message: Message can't be empty."],
    [{ conversationId: "x", message: "a".repeat(10_001) }, "message: Messages can be up to 10,000 characters."],
    [{ message: "Hi" }, "conversationId: Invalid input: expected string, received undefined"],
  ])("rejects an invalid body %#", async (body, error) => {
    const response = await POST(chatRequest(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(generateChatReply).not.toHaveBeenCalled();
  });

  it("requires sign-in", async () => {
    signInAs(null);
    const response = await POST(chatRequest({ conversationId: "x", message: "Hi" }));
    expect(response.status).toBe(401);
    expect(generateChatReply).not.toHaveBeenCalled();
  });
});
