import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "@/types";
import type { Toolbox } from "./chat";

// A stand-in for the SDK's message stream: replays events, then returns the final message
const { stream } = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("./anthropic", () => ({
  anthropic: { beta: { messages: { stream } } },
  CHAT_MODEL: "test-model",
  CHAT_EFFORT: "low",
  CHAT_MAX_TOKENS: 1000,
}));

const { describeChatError, generateChatReply, MAX_RETRIES, MAX_TOOL_ROUNDS, retryDelay, usageOf } = await import(
  "./chat"
);
const { RAG_SYSTEM_PROMPT } = await import("./prompts");

type StreamEvent = Anthropic.Beta.BetaRawMessageStreamEvent;
type ContentBlock = Anthropic.Beta.BetaContentBlock;

const textDelta = (text: string): StreamEvent =>
  ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }) as StreamEvent;

const text = (value: string): ContentBlock => ({ type: "text", text: value, citations: null });
const thinking = (signature: string): ContentBlock => ({ type: "thinking", thinking: "", signature });
const toolUse = (id: string, input: unknown, name = "search_documents"): ContentBlock =>
  ({ type: "tool_use", id, name, input }) as ContentBlock;
const fallback = (): ContentBlock =>
  ({ type: "fallback", from: { model: "test-model" }, to: { model: "fallback-model" } }) as unknown as ContentBlock;

function fakeStream(events: StreamEvent[], finalMessage: Partial<Anthropic.Beta.BetaMessage>) {
  stream.mockReturnValueOnce({
    async *[Symbol.asyncIterator]() {
      yield* events;
    },
    finalMessage: async () => ({
      model: "test-model",
      stop_reason: "end_turn",
      content: [],
      usage: { input_tokens: 10, output_tokens: 5 },
      ...finalMessage,
    }),
  });
}

/** One round in which Claude asks for tools */
function toolRound(content: ContentBlock[], events: StreamEvent[] = []) {
  fakeStream(events, { stop_reason: "tool_use", content });
}

/** A toolbox whose tools answer from a script, recording what they were asked */
function fakeToolbox(run: Toolbox["run"] = async (_name, input) => ({ output: `result for ${JSON.stringify(input)}`, isError: false })) {
  return {
    definitions: [{ name: "search_documents", description: "Search", input_schema: { type: "object" as const } }],
    describe: (name: string, input: unknown) => `${name} ${JSON.stringify(input)}`,
    run: vi.fn(run),
  } satisfies Toolbox;
}

const firstQuestion = [{ role: "user" as const, content: "Question" }];
const requestAt = (call: number) => stream.mock.calls[call][0];

beforeEach(() => {
  stream.mockReset();
});

describe("generateChatReply", () => {
  it("streams text deltas and resolves with the full reply", async () => {
    fakeStream([textDelta("Hello"), textDelta(", world")], {
      content: [text("Hello, world")],
      usage: {
        input_tokens: 100,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 30,
        output_tokens: 7,
      } as Anthropic.Beta.BetaUsage,
    });
    const onText = vi.fn();

    const reply = await generateChatReply([{ role: "user", content: "Hi" }], { onText });

    expect(onText.mock.calls.map(([piece]) => piece)).toEqual(["Hello", ", world"]);
    expect(reply).toEqual({
      text: "Hello, world",
      model: "test-model",
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 7, cacheReadTokens: 30, cacheWriteTokens: 20 },
      // The whole prompt: uncached + cache reads + cache writes
      contextTokens: 150,
      toolCalls: [],
    });
  });

  it("sends the conversation with the configured model, prompt and refusal fallback", async () => {
    fakeStream([], { content: [text("ok")] });
    const signal = new AbortController().signal;

    await generateChatReply(firstQuestion, { onText: () => {}, signal });

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        max_tokens: 1000,
        system: RAG_SYSTEM_PROMPT,
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01", "compact-2026-09-04"],
        fallbacks: "default",
      }),
      // Retries are ours, so the user can be told about them
      { signal, maxRetries: 0 },
    );
    // No toolbox, no tools
    expect(requestAt(0)).not.toHaveProperty("tools");
  });

  it("caches the conversation up to the new question, not the question itself", async () => {
    fakeStream([], { content: [text("ok")] });

    await generateChatReply(
      [
        { role: "user", content: "First" },
        { role: "assistant", content: "Reply" },
        { role: "user", content: "<context>passages</context> Second" },
      ],
      { onText: () => {} },
    );

    // The breakpoint ends the prefix the next request will start with
    expect(requestAt(0).messages).toEqual([
      { role: "user", content: "First" },
      {
        role: "assistant",
        content: [{ type: "text", text: "Reply", cache_control: { type: "ephemeral" } }],
      },
      { role: "user", content: "<context>passages</context> Second" },
    ]);
    // No automatic breakpoint, which would land on the one-off passages
    expect(requestAt(0)).not.toHaveProperty("cache_control");
  });

  it("sends images before the text, labelled, and caches history that has them", async () => {
    fakeStream([], { content: [text("ok")] });
    const chart = { kind: "image" as const, name: "chart.png", mediaType: "image/png" as const, data: "AAAA" };

    await generateChatReply(
      [
        { role: "user", content: "", images: [chart, { kind: "omitted", name: "old.jpg" }] },
        { role: "assistant", content: "A bar chart." },
        { role: "user", content: "Compare it", images: [{ ...chart, name: "new.png" }] },
      ],
      { onText: () => {} },
    );

    const image = (data: string) => ({ type: "image", source: { type: "base64", media_type: "image/png", data } });
    expect(requestAt(0).messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Image 1: chart.png" },
          image("AAAA"),
          { type: "text", text: "Image 2: old.jpg (no longer included, to keep the conversation within size limits)" },
          // Sent without text: the API needs some, so it gets a stand-in question
          { type: "text", text: "Please analyze these images." },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "A bar chart.", cache_control: { type: "ephemeral" } }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "Image 1: new.png" }, image("AAAA"), { type: "text", text: "Compare it" }],
      },
    ]);
  });

  it("sets no cache breakpoint on the first message of a chat", async () => {
    fakeStream([], { content: [text("ok")] });

    await generateChatReply([{ role: "user", content: "Hi" }], { onText: () => {} });

    expect(requestAt(0).messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("returns exactly the streamed text, skipping thinking and fallback blocks", async () => {
    // A mid-reply fallback: the second model continues the first one's partial text
    fakeStream([textDelta("The answer "), textDelta("is 42.")], {
      model: "fallback-model",
      content: [thinking("sig"), text("The answer "), fallback(), text("is 42.")],
    });

    const reply = await generateChatReply(firstQuestion, { onText: () => {} });

    expect(reply.text).toBe("The answer is 42.");
    expect(reply.model).toBe("fallback-model");
  });

  it("passes refusals through for the caller to handle", async () => {
    fakeStream([], { stop_reason: "refusal", content: [] });
    const reply = await generateChatReply(firstQuestion, { onText: () => {} });
    expect(reply).toMatchObject({ stopReason: "refusal", text: "" });
  });
});

describe("generateChatReply with tools", () => {
  it("runs the tools Claude asks for, sends the results back, and returns the answer", async () => {
    const round1 = [thinking("sig-1"), toolUse("call-1", { query: "load balancers" })];
    toolRound(round1);
    fakeStream([textDelta("ALBs work at layer 7.")], { content: [text("ALBs work at layer 7.")] });
    const toolbox = fakeToolbox();
    const onToolCall = vi.fn<(call: ToolCall) => void>();

    const reply = await generateChatReply(firstQuestion, { onText: () => {}, toolbox, onToolCall });

    expect(requestAt(0).tools).toEqual(toolbox.definitions);
    expect(toolbox.run).toHaveBeenCalledWith("search_documents", { query: "load balancers" });
    // Round 2 replays Claude's turn unchanged (thinking included), then the results
    expect(requestAt(1).messages).toEqual([
      { role: "user", content: "Question" },
      { role: "assistant", content: round1 },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call-1",
            content: 'result for {"query":"load balancers"}',
            // The end of the conversation so far, re-read by any further round
            cache_control: { type: "ephemeral" },
          },
        ],
      },
    ]);
    const done: ToolCall = {
      id: "call-1",
      name: "search_documents",
      input: { query: "load balancers" },
      label: 'search_documents {"query":"load balancers"}',
      status: "done",
      output: 'result for {"query":"load balancers"}',
    };
    expect(onToolCall.mock.calls.map(([call]) => call)).toEqual([
      { ...done, status: "running", output: null },
      done,
    ]);
    expect(reply).toEqual({
      text: "ALBs work at layer 7.",
      model: "test-model",
      stopReason: "end_turn",
      // Both rounds' usage; the context is the first request's prompt
      usage: { inputTokens: 20, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
      contextTokens: 10,
      toolCalls: [done],
    });
  });

  it("answers parallel calls together, in order, in one message", async () => {
    toolRound([toolUse("a", { query: "first" }), toolUse("b", { query: "second" })]);
    fakeStream([], { content: [text("Done")] });
    // The first call finishes last: results still go back in call order
    const toolbox = fakeToolbox(async (_name, input) => {
      const { query } = input as { query: string };
      await new Promise((resolve) => setTimeout(resolve, query === "first" ? 20 : 0));
      return { output: query, isError: false };
    });

    const reply = await generateChatReply(firstQuestion, { onText: () => {}, toolbox });

    const results = requestAt(1).messages.at(-1);
    expect(results.content.map((block: { tool_use_id: string }) => block.tool_use_id)).toEqual(["a", "b"]);
    expect(reply.toolCalls.map((call) => [call.id, call.output])).toEqual([
      ["a", "first"],
      ["b", "second"],
    ]);
  });

  it("reports failed calls to Claude as errors it can act on", async () => {
    toolRound([toolUse("bad", { document_id: "nope" }, "get_page_content")]);
    fakeStream([], { content: [text("Sorry")] });
    const toolbox = fakeToolbox(async () => ({ output: "No such document", isError: true }));

    const reply = await generateChatReply(firstQuestion, { onText: () => {}, toolbox });

    expect(requestAt(1).messages.at(-1).content[0]).toMatchObject({
      tool_use_id: "bad",
      content: "No such document",
      is_error: true,
    });
    expect(reply.toolCalls[0]).toMatchObject({ status: "failed", output: "No such document" });
  });

  it("turns a crashing tool into an error result without exposing it", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    toolRound([toolUse("crash", { query: "x" })]);
    fakeStream([], { content: [text("Answer anyway")] });
    const toolbox = fakeToolbox(async () => {
      throw new Error("database password is hunter2");
    });

    const reply = await generateChatReply(firstQuestion, { onText: () => {}, toolbox });

    const result = requestAt(1).messages.at(-1).content[0];
    expect(result).toMatchObject({ is_error: true, content: expect.stringMatching(/failed unexpectedly/) });
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(reply.toolCalls[0].status).toBe("failed");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("gives up on a crashing tool when the reply was abandoned", async () => {
    const controller = new AbortController();
    toolRound([toolUse("call", { query: "x" })]);
    const toolbox = fakeToolbox(async () => {
      controller.abort();
      throw new Anthropic.APIUserAbortError();
    });

    await expect(
      generateChatReply(firstQuestion, { onText: () => {}, toolbox, signal: controller.signal }),
    ).rejects.toThrow(Anthropic.APIUserAbortError);
    expect(stream).toHaveBeenCalledOnce();
  });

  it(`makes Claude answer after ${MAX_TOOL_ROUNDS} rounds of tools`, async () => {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      toolRound([toolUse(`call-${round}`, { query: `attempt ${round}` })]);
    }
    fakeStream([textDelta("Here's what I found.")], { content: [text("Here's what I found.")] });
    const toolbox = fakeToolbox();

    const reply = await generateChatReply(firstQuestion, { onText: () => {}, toolbox });

    expect(toolbox.run).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
    expect(stream).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 1);
    expect(requestAt(MAX_TOOL_ROUNDS - 1)).not.toHaveProperty("tool_choice");
    // Same tools (changing them would invalidate Claude's thinking), but no more calls
    expect(requestAt(MAX_TOOL_ROUNDS)).toMatchObject({
      tools: toolbox.definitions,
      tool_choice: { type: "none" },
    });
    expect(reply.text).toBe("Here's what I found.");
  });

  it("keeps at most two cache breakpoints, however many rounds run", async () => {
    toolRound([toolUse("1", { query: "a" })]);
    toolRound([toolUse("2", { query: "b" })]);
    fakeStream([], { content: [text("ok")] });

    await generateChatReply(
      [
        { role: "user", content: "Earlier" },
        { role: "assistant", content: "Answer" },
        { role: "user", content: "Question" },
      ],
      { onText: () => {}, toolbox: fakeToolbox() },
    );

    const breakpoints = JSON.stringify(requestAt(2).messages).match(/cache_control/g);
    expect(breakpoints).toHaveLength(2);
    // The previous round's breakpoint moved to the newest results
    expect(requestAt(2).messages.at(-3).content.at(-1)).not.toHaveProperty("cache_control");
  });

  it("never runs a tool call that may have been cut off", async () => {
    fakeStream([], { stop_reason: "max_tokens", content: [toolUse("cut", { query: "trunc" })] });
    const toolbox = fakeToolbox();

    const reply = await generateChatReply(firstQuestion, { onText: () => {}, toolbox });

    expect(toolbox.run).not.toHaveBeenCalled();
    expect(reply).toMatchObject({ stopReason: "max_tokens", toolCalls: [] });
  });

  it("separates text from different rounds, and streams the break too", async () => {
    toolRound([text("Let me check."), toolUse("1", { query: "x" })], [textDelta("Let me check.")]);
    fakeStream([textDelta("Found it.")], { content: [text("Found it.")] });
    const onText = vi.fn();

    const reply = await generateChatReply(firstQuestion, { onText, toolbox: fakeToolbox() });

    expect(reply.text).toBe("Let me check.\n\nFound it.");
    expect(onText.mock.calls.map(([piece]) => piece).join("")).toBe(reply.text);
  });

  it("after a mid-reply fallback, sends back only the text from before the switch", async () => {
    toolRound([
      thinking("declined-model"),
      text("Partial "),
      toolUse("declined", { query: "never made" }),
      fallback(),
      thinking("fallback-model"),
      toolUse("made", { query: "real" }),
    ]);
    fakeStream([], { content: [text("Answer")] });
    const toolbox = fakeToolbox();

    await generateChatReply(firstQuestion, { onText: () => {}, toolbox });

    expect(toolbox.run).toHaveBeenCalledOnce();
    expect(toolbox.run).toHaveBeenCalledWith("search_documents", { query: "real" });
    expect(requestAt(1).messages[1]).toEqual({
      role: "assistant",
      content: [text("Partial "), thinking("fallback-model"), toolUse("made", { query: "real" })],
    });
  });
});

describe("generateChatReply with a compacted conversation", () => {
  const summary = {
    type: "compaction" as const,
    content: "The user asked about load balancers.",
    signature: "sig",
    encrypted_content: null,
  };

  it("sends the summary first, in place of the older messages, unchanged", async () => {
    fakeStream([], { content: [text("ok")] });

    await generateChatReply(
      [
        { role: "user", content: "Kept question" },
        { role: "assistant", content: "Kept answer" },
        { role: "user", content: "New question" },
      ],
      { onText: () => {}, compaction: summary },
    );

    expect(requestAt(0).messages).toEqual([
      { role: "assistant", content: [summary] },
      { role: "user", content: "Kept question" },
      {
        role: "assistant",
        content: [{ type: "text", text: "Kept answer", cache_control: { type: "ephemeral" } }],
      },
      { role: "user", content: "New question" },
    ]);
  });

  it("caches the summary itself when nothing comes between it and the question", async () => {
    fakeStream([], { content: [text("ok")] });

    await generateChatReply([{ role: "user", content: "New question" }], { onText: () => {}, compaction: summary });

    expect(requestAt(0).messages[0]).toEqual({
      role: "assistant",
      content: [{ ...summary, cache_control: { type: "ephemeral" } }],
    });
  });
});

describe("usageOf", () => {
  it("uses the top-level usage when there's only one attempt", () => {
    expect(
      usageOf({
        input_tokens: 5,
        output_tokens: 6,
        cache_read_input_tokens: 7,
        cache_creation_input_tokens: null,
      } as Anthropic.Beta.BetaUsage),
    ).toEqual({ inputTokens: 5, outputTokens: 6, cacheReadTokens: 7, cacheWriteTokens: 0 });
  });

  it("sums every attempt after a refusal fallback, not just the one that answered", () => {
    const attempt = (input: number, output: number) => ({
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: 1,
      cache_creation_input_tokens: 2,
    });
    expect(
      usageOf({
        ...attempt(30, 40), // top level: only the fallback model's attempt
        iterations: [
          { type: "message", model: "test-model", ...attempt(10, 20) },
          { type: "fallback_message", model: "fallback-model", ...attempt(30, 40) },
        ],
      } as Anthropic.Beta.BetaUsage),
    ).toEqual({ inputTokens: 40, outputTokens: 60, cacheReadTokens: 2, cacheWriteTokens: 4 });
  });
});

describe("generateChatReply when Claude is busy", () => {
  /** An error the way the SDK raises it, asking for an immediate retry so tests don't wait */
  const rateLimited = (headers: Record<string, string> = { "retry-after-ms": "0" }) =>
    new Anthropic.RateLimitError(429, undefined, "rate limited", new Headers(headers));

  function failingStream(error: unknown, events: StreamEvent[] = []) {
    stream.mockReturnValueOnce({
      async *[Symbol.asyncIterator]() {
        yield* events;
        throw error;
      },
      finalMessage: async () => {
        throw error;
      },
    });
  }

  it("waits and retries, telling the caller why and for how long", async () => {
    failingStream(rateLimited({ "retry-after-ms": "0" }));
    failingStream(new Anthropic.InternalServerError(529, undefined, "overloaded", new Headers({ "retry-after": "0" })));
    fakeStream([textDelta("Finally")], { content: [text("Finally")] });
    const onRetry = vi.fn();

    const reply = await generateChatReply(firstQuestion, { onText: () => {}, onRetry });

    expect(reply.text).toBe("Finally");
    expect(stream).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls.map(([notice]) => notice)).toEqual([
      { reason: "rate_limited", delayMs: 0 },
      { reason: "unavailable", delayMs: 0 },
    ]);
  });

  it(`gives up after ${MAX_RETRIES} retries`, async () => {
    for (let i = 0; i <= MAX_RETRIES; i++) failingStream(rateLimited());

    await expect(generateChatReply(firstQuestion, { onText: () => {} })).rejects.toThrow(Anthropic.RateLimitError);
    expect(stream).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });

  it("doesn't retry once text has reached the user", async () => {
    failingStream(rateLimited(), [textDelta("Half an ans")]);

    await expect(generateChatReply(firstQuestion, { onText: () => {} })).rejects.toThrow(Anthropic.RateLimitError);
    expect(stream).toHaveBeenCalledOnce();
  });

  it.each([
    ["a bad request", new Anthropic.BadRequestError(400, undefined, "bad", new Headers())],
    ["a wait longer than we'll hold the user", rateLimited({ "retry-after": "120" })],
    ["the API saying not to", rateLimited({ "retry-after-ms": "0", "x-should-retry": "false" })],
  ])("doesn't retry %s", async (_case, error) => {
    failingStream(error);
    await expect(generateChatReply(firstQuestion, { onText: () => {} })).rejects.toBe(error);
    expect(stream).toHaveBeenCalledOnce();
  });

  it("stops waiting when the reply is abandoned", async () => {
    const controller = new AbortController();
    failingStream(rateLimited({ "retry-after": "10" }));
    const onRetry = vi.fn(() => controller.abort());

    await expect(
      generateChatReply(firstQuestion, { onText: () => {}, onRetry, signal: controller.signal }),
    ).rejects.toThrow(Anthropic.APIUserAbortError);
    expect(stream).toHaveBeenCalledOnce();
  });
});

describe("retryDelay", () => {
  it("uses the wait the API asked for", () => {
    expect(retryDelay(new Anthropic.RateLimitError(429, undefined, "", new Headers({ "retry-after-ms": "1500.2" })), 0)).toBe(1501);
    expect(retryDelay(new Anthropic.RateLimitError(429, undefined, "", new Headers({ "retry-after": "3" })), 0)).toBe(3000);
    const inFiveSeconds = new Date(Date.now() + 5000).toUTCString();
    const fromDate = retryDelay(new Anthropic.RateLimitError(429, undefined, "", new Headers({ "retry-after": inFiveSeconds })), 0);
    // HTTP dates have whole-second precision
    expect(fromDate).toBeGreaterThan(3000);
    expect(fromDate).toBeLessThanOrEqual(5000);
  });

  it("otherwise backs off exponentially, with jitter", () => {
    const error = new Anthropic.APIConnectionError({ message: "reset" });
    const random = vi.spyOn(Math, "random");
    random.mockReturnValue(0.5); // no jitter
    expect([0, 1, 2].map((attempt) => retryDelay(error, attempt))).toEqual([1000, 2000, 4000]);
    random.mockReturnValue(0); // the least jitter allows
    expect(retryDelay(error, 0)).toBe(750);
    random.mockRestore();
  });
});

describe("describeChatError", () => {
  const headers = new Headers();

  it.each([
    [new Anthropic.RateLimitError(429, undefined, "rate limited", headers), /a lot of requests/, false],
    [new Anthropic.InternalServerError(529, undefined, "overloaded", headers), /temporarily unavailable/, true],
    [new Anthropic.AuthenticationError(401, undefined, "bad key", headers), /isn't configured/, true],
    [new Anthropic.PermissionDeniedError(403, undefined, "nope", headers), /isn't configured/, true],
    [new Anthropic.APIConnectionTimeoutError(), /Couldn't reach Claude/, true],
    [new Anthropic.BadRequestError(400, undefined, "bad", headers), /Something went wrong/, true],
    [new Error("database down"), /Something went wrong/, true],
  ])("describes %s", (error, message, log) => {
    const described = describeChatError(error);
    expect(described.message).toMatch(message);
    expect(described.log).toBe(log);
  });

  it("never leaks the underlying error text", () => {
    const described = describeChatError(new Error("secret internal detail"));
    expect(described.message).not.toContain("secret");
  });
});
