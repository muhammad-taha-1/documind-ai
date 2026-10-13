import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { Session } from "next-auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatReply } from "@/lib/ai/chat";
import { COMPACT_AT_TOKENS } from "@/lib/ai/context";
import { buildRAGPrompt } from "@/lib/ai/prompts";
import { FULL_TEXT_MAX_CHARACTERS } from "@/lib/ai/rag";
import { prisma } from "@/lib/db/prisma";
import { toVectorLiteral } from "@/lib/db/vectors";
import { readNdjson } from "@/lib/chat/stream";
import { makeVector } from "@/test/embeddings";
import type { ChatStreamEvent, ToolCall } from "@/types";

const getSession = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/lib/auth", () => ({ getSession }));

// Claude is scripted per test; describeChatError stays real
type Generate = typeof import("@/lib/ai/chat").generateChatReply;
const generateChatReply = vi.hoisted(() => vi.fn<Generate>());
vi.mock("@/lib/ai/chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/chat")>()),
  generateChatReply,
}));

// The question's embedding is scripted per test; the search itself runs in Postgres
const generateEmbedding = vi.hoisted(() => vi.fn<(text: string) => Promise<number[]>>());
vi.mock("@/lib/ai/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/embeddings")>()),
  generateEmbedding,
}));

// Titles come from a small model; scripted per test
const generateTitle = vi.hoisted(() => vi.fn<(message: string) => Promise<string | null>>());
vi.mock("@/lib/ai/title", () => ({ generateTitle }));

// Compaction has its own tests; here, only whether the route asks for it
const compactConversation = vi.hoisted(() => vi.fn<(conversationId: string) => Promise<string>>());
vi.mock("@/lib/ai/compaction", () => ({ compactConversation }));

// after() needs a live Next.js request; collect the callbacks so tests can run them
const scheduled = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => unknown) => scheduled.push(callback),
}));

const { POST } = await import("./route");

/** Runs what the route left for after the response */
async function runScheduled() {
  for (const callback of scheduled.splice(0)) await callback();
}

const USAGE = { inputTokens: 30, outputTokens: 12, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** What Claude is sent for a chat with no searchable documents */
const withoutDocuments = (question: string) =>
  buildRAGPrompt(question, { mode: "NO_DOCUMENTS", sources: [] }, []);

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
      usage: USAGE,
      contextTokens: 30,
      toolCalls: [],
      ...overrides,
    };
  };
}

/**
 * Plays Claude calling tools: runs each call through the real toolbox the
 * route built (so against the database), reports it like the tool loop does,
 * then answers.
 */
function replyUsingTools(calls: [name: string, input: unknown][], answer: string): Generate {
  return async (_turns, { onText, onToolCall, toolbox }) => {
    const toolCalls: ToolCall[] = [];
    for (const [i, [name, input]] of calls.entries()) {
      const { output, isError } = await toolbox!.run(name, input);
      const call: ToolCall = {
        id: `call-${i}`,
        name,
        input,
        label: toolbox!.describe(name, input),
        status: isError ? "failed" : "done",
        output,
      };
      onToolCall?.(call);
      toolCalls.push(call);
    }
    onText(answer);
    return { text: answer, model: "claude-test", stopReason: "end_turn", usage: USAGE, contextTokens: 30, toolCalls };
  };
}

async function createConversation(userId: string, documentIds: string[] = []) {
  const { id } = await prisma.conversation.create({ data: { userId, documentIds } });
  return id;
}

/** A READY document whose chunks have the given text and embeddings */
async function createDocument(
  userId: string,
  title: string,
  chunks: { content: string; vector: number[] }[],
) {
  const document = await prisma.document.create({
    data: { title, fileName: "d.pdf", fileSize: 1, filePath: "unused", status: "READY", userId },
  });
  const chunkIds: string[] = [];
  for (const [chunkIndex, { content, vector }] of chunks.entries()) {
    const { id } = await prisma.documentChunk.create({
      data: { documentId: document.id, chunkIndex, pageNumber: chunkIndex + 1, content },
    });
    await prisma.$executeRaw`
      UPDATE "DocumentChunk" SET embedding = ${toVectorLiteral(vector)}::vector WHERE id = ${id}
    `;
    chunkIds.push(id);
  }
  return { id: document.id, chunkIds };
}

/** Text long enough that a few chunks exceed the full-text limit, so retrieval has to search */
const longText = (label: string) => `${label} ${"filler ".repeat(300)}`;

const findMessages = (conversationId: string) =>
  prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });

/** `count` earlier messages, alternating user/assistant a second apart: "message 0", "message 1", … */
async function createMessages(conversationId: string, count: number) {
  const start = Date.now() - 60 * 60_000;
  await prisma.message.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      conversationId,
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message ${i}`,
      createdAt: new Date(start + i * 1000),
    })),
  });
  return findMessages(conversationId);
}

beforeAll(async () => {
  const runId = randomUUID();
  ownerId = (await prisma.user.create({ data: { email: `owner-${runId}@test.local` } })).id;
  otherUserId = (await prisma.user.create({ data: { email: `other-${runId}@test.local` } })).id;
});

beforeEach(async () => {
  await prisma.conversation.deleteMany({ where: { userId: { in: [ownerId, otherUserId] } } });
  await prisma.document.deleteMany({ where: { userId: { in: [ownerId, otherUserId] } } });
  generateChatReply.mockReset();
  generateEmbedding.mockReset();
  generateTitle.mockReset().mockResolvedValue(null);
  compactConversation.mockReset().mockResolvedValue("compacted");
  scheduled.length = 0;
  signInAs(ownerId);
  // The route logs each retrieval for threshold tuning
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherUserId] } } });
  await prisma.$disconnect();
});

describe("POST /api/chat", () => {
  it("streams the reply, then saves both messages with the reply's usage, and names the chat", async () => {
    const id = await createConversation(ownerId);
    generateChatReply.mockImplementation(replyWith(["Hello", " there", "!"]));
    generateTitle.mockResolvedValue("Greeting Claude");

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
      userMessage: { role: "user", content: "Hi Claude", retrieval: null, sources: [] },
      assistantMessage: {
        role: "assistant",
        content: "Hello there!",
        retrieval: "NO_DOCUMENTS",
        sources: [],
        usage: USAGE,
      },
      conversation: { id, title: "Greeting Claude" },
    });
    expect(generateTitle).toHaveBeenCalledWith("Hi Claude", expect.anything());

    const saved = await findMessages(id);
    expect(
      saved.map((m) => [m.role, m.content, m.model, m.inputTokens, m.outputTokens, m.contextTokens]),
    ).toEqual([
      ["user", "Hi Claude", null, null, null, null],
      ["assistant", "Hello there!", "claude-test", 30, 12, 30],
    ]);
    // The message is sent trimmed, as the only turn
    expect(generateChatReply.mock.calls[0][0]).toEqual([
      { role: "user", content: withoutDocuments("Hi Claude") },
    ]);
  });

  it("sends earlier messages as plain history and keeps the title after the first exchange", async () => {
    const id = await createConversation(ownerId);
    generateChatReply.mockImplementation(replyWith(["First answer"]));
    await readEvents(await POST(chatRequest({ conversationId: id, message: "First question" })));
    const afterFirst = await prisma.conversation.findUniqueOrThrow({ where: { id } });

    generateChatReply.mockImplementation(replyWith(["Second answer"]));
    const events = await readEvents(
      await POST(chatRequest({ conversationId: id, message: "Second question" })),
    );

    expect(generateChatReply.mock.calls[1][0]).toEqual([
      // Saved as asked: earlier questions don't carry their passages again
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: withoutDocuments("Second question") },
    ]);
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    // No generated title (the mock returns null), so the first question names the chat
    expect(conversation.title).toBe("First question");
    expect(generateTitle).toHaveBeenCalledOnce();
    // Each exchange moves the chat to the top of the sidebar
    expect(conversation.updatedAt.getTime()).toBeGreaterThan(afterFirst.updatedAt.getTime());
    expect(events.at(-1)).toMatchObject({ type: "done", conversation: { title: "First question" } });
  });

  it("sends the whole conversation, not a sliding window", async () => {
    const id = await createConversation(ownerId);
    await createMessages(id, 25);
    generateChatReply.mockImplementation(replyWith(["ok"]));

    await readEvents(await POST(chatRequest({ conversationId: id, message: "latest" })));

    const [turns, options] = generateChatReply.mock.calls[0];
    expect(turns).toHaveLength(26);
    expect(turns[0]).toEqual({ role: "user", content: "message 0" });
    expect(turns.at(-1)).toEqual({ role: "user", content: withoutDocuments("latest") });
    expect(options.compaction).toBeUndefined();
  });

  it("sends the summary of a compacted conversation, then only the messages after it", async () => {
    const id = await createConversation(ownerId);
    const messages = await createMessages(id, 6);
    const block = { type: "compaction", content: "Summary of messages 0-3", signature: "sig", encrypted_content: null };
    await prisma.conversation.update({
      where: { id },
      data: { compaction: block, compactedThrough: messages[3].createdAt },
    });
    generateChatReply.mockImplementation(replyWith(["ok"]));

    await readEvents(await POST(chatRequest({ conversationId: id, message: "latest" })));

    const [turns, options] = generateChatReply.mock.calls[0];
    expect(options.compaction).toEqual(block);
    expect(turns).toEqual([
      { role: "user", content: "message 4" },
      { role: "assistant", content: "message 5" },
      { role: "user", content: withoutDocuments("latest") },
    ]);
    // Compacted, so not new: no title
    expect(generateTitle).not.toHaveBeenCalled();
  });

  it("compacts the conversation after a reply that read more than the budget", async () => {
    const id = await createConversation(ownerId);
    generateChatReply.mockImplementation(replyWith(["ok"], { contextTokens: COMPACT_AT_TOKENS + 1 }));

    const events = await readEvents(await POST(chatRequest({ conversationId: id, message: "Hi" })));
    // Not while the user waits: after the response
    expect(events.at(-1)?.type).toBe("done");
    expect(compactConversation).not.toHaveBeenCalled();

    await runScheduled();
    expect(compactConversation).toHaveBeenCalledWith(id);
  });

  it("doesn't compact a conversation within budget, or after a failed reply", async () => {
    const id = await createConversation(ownerId);
    generateChatReply.mockImplementation(replyWith(["ok"], { contextTokens: COMPACT_AT_TOKENS }));
    await readEvents(await POST(chatRequest({ conversationId: id, message: "Hi" })));
    generateChatReply.mockImplementation(
      replyWith([], { stopReason: "refusal", contextTokens: COMPACT_AT_TOKENS * 2 }),
    );
    await readEvents(await POST(chatRequest({ conversationId: id, message: "Again" })));

    await runScheduled();
    expect(compactConversation).not.toHaveBeenCalled();
  });

  it("logs a failed compaction without affecting the saved reply", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await createConversation(ownerId);
    compactConversation.mockRejectedValue(new Error("API down"));
    generateChatReply.mockImplementation(replyWith(["ok"], { contextTokens: COMPACT_AT_TOKENS + 1 }));

    await readEvents(await POST(chatRequest({ conversationId: id, message: "Hi" })));
    await runScheduled();

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(id), expect.any(Error));
    expect(await findMessages(id)).toHaveLength(2);
    consoleError.mockRestore();
  });

  it("tells the browser when it's waiting to retry", async () => {
    const id = await createConversation(ownerId);
    generateChatReply.mockImplementation(async (turns, options) => {
      options.onRetry?.({ reason: "rate_limited", delayMs: 2000 });
      return replyWith(["ok"])(turns, options);
    });

    const events = await readEvents(await POST(chatRequest({ conversationId: id, message: "Hi" })));

    expect(events[0]).toEqual({ type: "retry", reason: "rate_limited", delayMs: 2000 });
    expect(events.at(-1)?.type).toBe("done");
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

const e0 = makeVector({ 0: 1 });

/** Too big to send whole: chunk 1 matches e0 exactly, chunk 2 partly, the rest not at all */
async function createSearchableDocument(userId = ownerId) {
  const chunks = [
    { content: longText("Exact"), vector: e0 },
    { content: longText("Partial"), vector: makeVector({ 0: Math.SQRT1_2, 1: Math.SQRT1_2 }) },
    ...Array.from({ length: 6 }, (_, i) => ({
      content: longText(`Unrelated ${i}`),
      vector: makeVector({ 1: 1 }),
    })),
  ];
  expect(chunks.reduce((total, chunk) => total + chunk.content.length, 0)).toBeGreaterThan(
    FULL_TEXT_MAX_CHARACTERS,
  );
  return createDocument(userId, "Guide", chunks);
}

describe("POST /api/chat document retrieval", () => {
  const lastPrompt = () => generateChatReply.mock.calls[0][0].at(-1)!.content;

  it("answers from the closest passages and saves them as numbered sources", async () => {
    const document = await createSearchableDocument();
    const id = await createConversation(ownerId, [document.id]);
    generateEmbedding.mockResolvedValue(e0);
    generateChatReply.mockImplementation(replyWith(["Per [Source 1], yes."]));

    const events = await readEvents(await POST(chatRequest({ conversationId: id, message: "Is it?" })));

    expect(generateEmbedding).toHaveBeenCalledWith("Is it?", { signal: expect.any(AbortSignal) });
    // Claude sees the passages, best first, then the question
    expect(lastPrompt()).toMatch(
      /<context>\n\[Source 1 — Guide, page 1\]\nExact filler[\s\S]*\[Source 2 — Guide, page 2\]\nPartial filler[\s\S]*<question>\nIs it\?\n<\/question>$/,
    );
    expect(lastPrompt()).not.toContain("Unrelated");

    expect(events.at(-1)).toMatchObject({
      type: "done",
      assistantMessage: {
        retrieval: "MATCHED",
        sources: [
          {
            position: 1,
            documentId: document.id,
            documentTitle: "Guide",
            pageNumber: 1,
            content: longText("Exact"),
            similarity: expect.closeTo(1, 5),
          },
          { position: 2, pageNumber: 2, similarity: expect.closeTo(Math.SQRT1_2, 5) },
        ],
      },
    });
    // Only the reply has sources; the question is saved exactly as asked
    const saved = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: "asc" },
      include: { sources: { orderBy: { position: "asc" } } },
    });
    expect(saved[0]).toMatchObject({ content: "Is it?", retrieval: null, sources: [] });
    expect(saved[1].retrieval).toBe("MATCHED");
    expect(saved[1].sources.map((source) => source.chunkId)).toEqual(document.chunkIds.slice(0, 2));
    expect(console.info).toHaveBeenCalledWith(
      `Retrieval in ${id}: MATCHED, 2 sources, best similarity 1.000`,
    );
  });

  it("sends small documents in full, without a search", async () => {
    const resume = await createDocument(ownerId, "Resume", [
      { content: "Summary", vector: makeVector({ 3: 1 }) },
      { content: "Experience", vector: makeVector({ 4: 1 }) },
    ]);
    const id = await createConversation(ownerId, [resume.id]);
    generateChatReply.mockImplementation(replyWith(["Looks good."]));

    const events = await readEvents(
      await POST(chatRequest({ conversationId: id, message: "Is this resume ok?" })),
    );

    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(lastPrompt()).toContain(
      "[Source 1 — Resume, page 1]\nSummary\n\n---\n\n[Source 2 — Resume, page 2]\nExperience",
    );
    expect(events.at(-1)).toMatchObject({
      assistantMessage: {
        retrieval: "FULL_TEXT",
        sources: [
          { position: 1, content: "Summary", similarity: null },
          { position: 2, content: "Experience", similarity: null },
        ],
      },
    });
  });

  it("flags a weak match", async () => {
    const document = await createSearchableDocument();
    const id = await createConversation(ownerId, [document.id]);
    // Similarity 0.25 to the "Exact" chunk and 0 to the rest
    generateEmbedding.mockResolvedValue(makeVector({ 0: 0.25, 2: Math.sqrt(1 - 0.25 ** 2) }));
    generateChatReply.mockImplementation(replyWith(["Not sure."]));

    const events = await readEvents(await POST(chatRequest({ conversationId: id, message: "Hmm?" })));

    expect(lastPrompt()).toContain("only loosely match");
    expect(events.at(-1)).toMatchObject({
      assistantMessage: {
        retrieval: "WEAK_MATCH",
        sources: [{ position: 1, similarity: expect.closeTo(0.25, 5) }],
      },
    });
  });

  it("tells Claude when nothing matches, and still answers", async () => {
    const document = await createSearchableDocument();
    const id = await createConversation(ownerId, [document.id]);
    generateEmbedding.mockResolvedValue(makeVector({ 9: 1 }));
    generateChatReply.mockImplementation(replyWith(["Your documents don't cover that."]));

    const events = await readEvents(
      await POST(chatRequest({ conversationId: id, message: "Cake recipe?" })),
    );

    expect(lastPrompt()).toBe(
      buildRAGPrompt("Cake recipe?", { mode: "NO_MATCH", sources: [] }, [
        { id: document.id, title: "Guide", pageCount: null },
      ]),
    );
    expect(events.at(-1)).toMatchObject({
      type: "done",
      assistantMessage: { retrieval: "NO_MATCH", sources: [] },
    });
  });

  it("never reads another user's document, even if its ID is in the chat", async () => {
    const theirs = await createDocument(otherUserId, "Private", [{ content: "secret", vector: e0 }]);
    // Can't happen through the API (it checks ownership), so insert directly
    const id = await createConversation(ownerId, [theirs.id]);
    generateChatReply.mockImplementation(replyWith(["Nothing to go on."]));

    const events = await readEvents(await POST(chatRequest({ conversationId: id, message: "Tell me" })));

    expect(lastPrompt()).toBe(withoutDocuments("Tell me"));
    expect(JSON.stringify(events)).not.toContain("secret");
  });

  it("reports a failed search and saves nothing, without calling Claude", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const document = await createSearchableDocument();
    const id = await createConversation(ownerId, [document.id]);
    generateEmbedding.mockRejectedValue(new Error("OpenAI unavailable"));

    const events = await readEvents(await POST(chatRequest({ conversationId: id, message: "Hi" })));

    expect(events).toEqual([
      { type: "error", error: "Couldn't search your documents. Please try again." },
    ]);
    expect(generateChatReply).not.toHaveBeenCalled();
    expect(await findMessages(id)).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(id), expect.any(Error));
    consoleError.mockRestore();
  });

  it("keeps the reply when a source disappears mid-answer, with the other numbers intact", async () => {
    const document = await createSearchableDocument();
    const id = await createConversation(ownerId, [document.id]);
    generateEmbedding.mockResolvedValue(e0);
    generateChatReply.mockImplementation(async (turns, options) => {
      // e.g. the document is reprocessed while Claude is answering
      await prisma.documentChunk.delete({ where: { id: document.chunkIds[0] } });
      return replyWith(["See [Source 2]."])(turns, options);
    });

    const events = await readEvents(await POST(chatRequest({ conversationId: id, message: "?" })));

    expect(events.at(-1)).toMatchObject({
      type: "done",
      assistantMessage: {
        content: "See [Source 2].",
        sources: [{ position: 2, content: longText("Partial") }],
      },
    });
    expect(await findMessages(id)).toHaveLength(2);
  });
});

describe("POST /api/chat tools", () => {
  it("numbers passages Claude searches for after the retrieved ones, and saves the calls", async () => {
    const document = await createSearchableDocument();
    const id = await createConversation(ownerId, [document.id]);
    // Retrieval matches "Exact" and "Partial" (Sources 1-2); the tool's search matches the rest
    generateEmbedding.mockResolvedValueOnce(e0).mockResolvedValueOnce(makeVector({ 1: 1 }));
    generateChatReply.mockImplementation(
      replyUsingTools([["search_documents", { query: "the other topics", max_results: 3 }]], "See [Source 3]."),
    );

    const events = await readEvents(await POST(chatRequest({ conversationId: id, message: "Tell me more" })));

    expect(generateEmbedding).toHaveBeenLastCalledWith("the other topics", { signal: expect.any(AbortSignal) });
    const toolEvent = events.find((event) => event.type === "tool");
    expect(toolEvent).toMatchObject({
      call: {
        name: "search_documents",
        label: 'Searched your documents for "the other topics"',
        status: "done",
        output: expect.stringMatching(/^\[Source 3 — Guide, page \d\]\nUnrelated/),
      },
    });
    const done = events.at(-1);
    expect(done).toMatchObject({
      type: "done",
      assistantMessage: {
        content: "See [Source 3].",
        toolCalls: [{ id: "call-0", name: "search_documents", status: "done" }],
      },
    });
    // Retrieval's two passages, then the tool's three, numbered in one sequence
    const { sources } = (done as Extract<ChatStreamEvent, { type: "done" }>).assistantMessage;
    expect(sources.map((source) => source.position)).toEqual([1, 2, 3, 4, 5]);
    expect(sources.slice(0, 2).map((source) => source.content)).toEqual([longText("Exact"), longText("Partial")]);
    expect(sources.slice(2).every((source) => source.content.startsWith("Unrelated"))).toBe(true);

    // Saved with the reply, so the chat shows them after a reload
    const saved = await prisma.message.findFirstOrThrow({
      where: { conversationId: id, role: "assistant" },
    });
    expect(saved.toolCalls).toEqual([
      expect.objectContaining({ id: "call-0", input: { query: "the other topics", max_results: 3 } }),
    ]);
  });

  it("reads a page, including the passage that runs into it", async () => {
    const document = await createDocument(ownerId, "Notes", [
      { content: "Page one text", vector: makeVector({ 5: 1 }) },
      { content: "Page two runs onto three", vector: makeVector({ 5: 1 }) },
      { content: "Page three text", vector: makeVector({ 5: 1 }) },
    ]);
    await prisma.document.update({ where: { id: document.id }, data: { pageCount: 3 } });
    const id = await createConversation(ownerId, [document.id]);
    generateChatReply.mockImplementation(
      replyUsingTools([["get_page_content", { document_id: document.id, page_number: 3 }]], "Page 3 says..."),
    );

    const events = await readEvents(await POST(chatRequest({ conversationId: id, message: "What's on page 3?" })));

    // Small enough to send whole, so retrieval already numbered all three:
    // the page's passages come back as references, not repeats
    expect(events.find((event) => event.type === "tool")).toMatchObject({
      call: {
        label: 'Read page 3 of "Notes"',
        output: "[Source 2 — Notes, page 2] (already shown above)\n\n---\n\n[Source 3 — Notes, page 3] (already shown above)",
      },
    });
    // The chat's document list told Claude the ID and page count
    expect(generateChatReply.mock.calls[0][0].at(-1)!.content).toContain(
      `- Notes (id: ${document.id}, 3 pages)`,
    );
  });

  it("looks up document details from the database", async () => {
    const document = await createDocument(ownerId, "Handbook", [{ content: "Text", vector: e0 }]);
    const id = await createConversation(ownerId, [document.id]);
    generateChatReply.mockImplementation(
      replyUsingTools([["get_document_info", { document_id: document.id }]], "It's a PDF."),
    );

    const events = await readEvents(await POST(chatRequest({ conversationId: id, message: "How big is it?" })));

    expect(events.find((event) => event.type === "tool")).toMatchObject({
      call: { status: "done", output: expect.stringContaining("File name: d.pdf") },
    });
  });

  it("won't let a tool reach a document outside the user's chat", async () => {
    const theirs = await createDocument(otherUserId, "Private notes", [{ content: "PRIVATE-PASSAGE", vector: e0 }]);
    // Can't happen through the API (it checks ownership), so insert directly
    const id = await createConversation(ownerId, [theirs.id]);
    generateChatReply.mockImplementation(
      replyUsingTools(
        [
          ["get_page_content", { document_id: theirs.id, page_number: 1 }],
          ["search_documents", { query: "secret", document_id: theirs.id }],
          ["get_document_info", { document_id: theirs.id }],
        ],
        "I can't see that.",
      ),
    );

    const events = await readEvents(await POST(chatRequest({ conversationId: id, message: "Read it" })));

    const calls = events.flatMap((event) => (event.type === "tool" ? [event.call] : []));
    expect(calls.map((call) => call.status)).toEqual(["failed", "failed", "failed"]);
    // Neither its text nor even its title leaks
    expect(JSON.stringify(events)).not.toContain("PRIVATE-PASSAGE");
    expect(JSON.stringify(events)).not.toContain("Private notes");
    expect(generateEmbedding).not.toHaveBeenCalled();
  });
});
