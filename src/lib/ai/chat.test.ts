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

const { describeChatError, generateChatReply, MAX_TOOL_ROUNDS } = await import("./chat");
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
      tokensUsed: 157,
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
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      }),
      { signal },
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
      tokensUsed: 30, // 15 per round
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
