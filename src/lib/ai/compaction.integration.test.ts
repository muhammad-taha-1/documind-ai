import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getChatHistory, getConversation } from "@/lib/chat/queries";
import { prisma } from "@/lib/db/prisma";

// The API is scripted; the conversation lives in the real database
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("./anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./anthropic")>()),
  anthropic: { beta: { messages: { create } } },
}));

const { compactConversation, COMPACTION_INSTRUCTIONS } = await import("./compaction");
const { RAG_SYSTEM_PROMPT } = await import("./prompts");
const { TOOLS } = await import("./tools");

let userId: string;

/** A compaction response as the API returns it */
function summaryResponse(content: string) {
  return {
    stop_reason: "compaction",
    content: [{ type: "compaction", content, signature: `sig-${content}`, encrypted_content: null }],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      iterations: [
        { type: "compaction", input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      ],
    },
  };
}

/** A conversation with `count` messages alternating user/assistant, a second apart */
async function createConversation(count: number) {
  const { id } = await prisma.conversation.create({ data: { userId, documentIds: [] } });
  const start = Date.now() - 60 * 60_000;
  await prisma.message.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      conversationId: id,
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message ${i}`,
      createdAt: new Date(start + i * 1000),
    })),
  });
  const messages = await prisma.message.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" } });
  return { id, messages };
}

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: `compaction-${randomUUID()}@test.local` } })).id;
});

beforeEach(async () => {
  await prisma.conversation.deleteMany({ where: { userId } });
  create.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("compactConversation", () => {
  it("summarizes all but the last two exchanges, and Claude sees the summary from then on", async () => {
    const { id, messages } = await createConversation(10);
    create.mockResolvedValueOnce(summaryResponse("Summary of 0-5"));

    expect(await compactConversation(id)).toBe("compacted");

    const [request] = create.mock.calls[0];
    expect(request).toMatchObject({
      // Same system prompt and tools as the chat itself
      system: RAG_SYSTEM_PROMPT,
      tools: TOOLS,
      betas: ["compact-2026-09-04"],
      compaction: { type: "summarize", instructions: COMPACTION_INSTRUCTIONS },
    });
    // Only what's being replaced: everything the summary covers, nothing it doesn't
    expect(request.messages).toEqual(
      messages.slice(0, 6).map(({ role, content }) => ({ role, content })),
    );

    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    // Stored exactly as returned, signature and all
    expect(conversation.compaction).toEqual(summaryResponse("Summary of 0-5").content[0]);
    expect(conversation.compactedThrough).toEqual(messages[5].createdAt);

    const history = await getChatHistory(userId, id);
    expect(history?.compaction).toMatchObject({ content: "Summary of 0-5" });
    expect(history?.turns.map((turn) => turn.content)).toEqual(["message 6", "message 7", "message 8", "message 9"]);
    expect(history?.isEmpty).toBe(false);

    // Every message stays visible to the user, with the summary marked
    const detail = await getConversation(userId, id);
    expect(detail?.messages).toHaveLength(10);
    expect(detail?.compaction).toEqual({
      summary: "Summary of 0-5",
      through: messages[5].createdAt.toISOString(),
    });
  });

  it("compacts again by summarizing the old summary with what came after it", async () => {
    const { id, messages } = await createConversation(14);
    create.mockResolvedValueOnce(summaryResponse("First summary"));
    await compactConversation(id); // covers 0-9
    create.mockResolvedValueOnce(summaryResponse("Second summary"));
    await prisma.message.createMany({
      data: [14, 15].map((i) => ({
        conversationId: id,
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `message ${i}`,
        createdAt: new Date(messages[13].createdAt.getTime() + (i - 13) * 1000),
      })),
    });

    expect(await compactConversation(id)).toBe("compacted");

    const [request] = create.mock.calls[1];
    expect(request.messages).toEqual([
      { role: "assistant", content: [summaryResponse("First summary").content[0]] },
      { role: "user", content: "message 10" },
      { role: "assistant", content: "message 11" },
    ]);
    const history = await getChatHistory(userId, id);
    expect(history?.compaction).toMatchObject({ content: "Second summary" });
    expect(history?.turns.map((turn) => turn.content)).toEqual([
      "message 12",
      "message 13",
      "message 14",
      "message 15",
    ]);
  });

  it("does nothing when there's nothing older than the exchanges it keeps", async () => {
    const { id } = await createConversation(4);
    expect(await compactConversation(id)).toBe("nothing_to_compact");
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps the conversation as it was when no summary comes back", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { id } = await createConversation(10);
    create.mockResolvedValueOnce({ stop_reason: "max_tokens", content: [], usage: { input_tokens: 0, output_tokens: 0 } });

    expect(await compactConversation(id)).toBe("no_summary");

    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    expect(conversation.compaction).toBeNull();
    expect((await getChatHistory(userId, id))?.turns).toHaveLength(10);
    consoleWarn.mockRestore();
  });

  it("doesn't overwrite a summary written while it was working", async () => {
    const { id, messages } = await createConversation(10);
    const theirs = { type: "compaction", content: "Theirs", signature: "s", encrypted_content: null };
    create.mockImplementationOnce(async () => {
      // Another server process compacts first
      await prisma.conversation.update({
        where: { id },
        data: { compaction: theirs, compactedThrough: messages[3].createdAt },
      });
      return summaryResponse("Ours");
    });

    expect(await compactConversation(id)).toBe("superseded");
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    expect(conversation.compaction).toEqual(theirs);
  });

  it("doesn't start a second compaction of the same conversation", async () => {
    const { id } = await createConversation(10);
    let finish: (value: unknown) => void = () => {};
    create.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));

    const first = compactConversation(id);
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(await compactConversation(id)).toBe("superseded");
    finish(summaryResponse("Only one"));
    expect(await first).toBe("compacted");
    expect(create).toHaveBeenCalledOnce();
  });

  it("falls back to the whole conversation if the stored summary is unusable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { id, messages } = await createConversation(6);
    await prisma.conversation.update({
      where: { id },
      data: { compaction: { type: "compaction", content: "" }, compactedThrough: messages[3].createdAt },
    });

    const history = await getChatHistory(userId, id);

    expect(history?.compaction).toBeNull();
    expect(history?.turns).toHaveLength(6);
    expect((await getConversation(userId, id))?.compaction).toBeNull();
    consoleError.mockRestore();
  });
});
