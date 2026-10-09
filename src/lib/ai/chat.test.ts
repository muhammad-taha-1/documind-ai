import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the SDK's message stream: replays events, then returns the final message
const { stream } = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("./anthropic", () => ({
  anthropic: { beta: { messages: { stream } } },
  CHAT_MODEL: "test-model",
  CHAT_EFFORT: "low",
  CHAT_MAX_TOKENS: 1000,
}));

const { describeChatError, generateChatReply } = await import("./chat");

type StreamEvent = Anthropic.Beta.BetaRawMessageStreamEvent;

const textDelta = (text: string): StreamEvent =>
  ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }) as StreamEvent;

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

beforeEach(() => {
  stream.mockReset();
});

describe("generateChatReply", () => {
  it("streams text deltas and resolves with the full reply", async () => {
    fakeStream([textDelta("Hello"), textDelta(", world")], {
      content: [{ type: "text", text: "Hello, world", citations: null }],
      usage: {
        input_tokens: 100,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 30,
        output_tokens: 7,
      } as Anthropic.Beta.BetaUsage,
    });
    const onText = vi.fn();

    const reply = await generateChatReply([{ role: "user", content: "Hi" }], { onText });

    expect(onText.mock.calls.map(([text]) => text)).toEqual(["Hello", ", world"]);
    expect(reply).toEqual({
      text: "Hello, world",
      model: "test-model",
      stopReason: "end_turn",
      tokensUsed: 157,
    });
  });

  it("sends the conversation with the configured model, refusal fallback and caching", async () => {
    fakeStream([], { content: [{ type: "text", text: "ok", citations: null }] });
    const signal = new AbortController().signal;
    const turns = [
      { role: "user" as const, content: "First" },
      { role: "assistant" as const, content: "Reply" },
      { role: "user" as const, content: "Second" },
    ];

    await generateChatReply(turns, { onText: () => {}, signal });

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        max_tokens: 1000,
        messages: turns,
        system: expect.stringContaining("DocuMind"),
        output_config: { effort: "low" },
        cache_control: { type: "ephemeral" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      }),
      { signal },
    );
  });

  it("returns only text, skipping thinking and fallback blocks", async () => {
    // A mid-reply fallback: the second model continues the first one's partial text
    fakeStream([], {
      model: "fallback-model",
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "The answer ", citations: null },
        {
          type: "fallback",
          from: { model: "test-model" },
          to: { model: "fallback-model" },
        } as unknown as Anthropic.Beta.BetaContentBlock,
        { type: "text", text: "is 42.", citations: null },
      ],
    });

    const reply = await generateChatReply([{ role: "user", content: "?" }], { onText: () => {} });

    expect(reply.text).toBe("The answer is 42.");
    expect(reply.model).toBe("fallback-model");
  });

  it("passes refusals through for the caller to handle", async () => {
    fakeStream([], { stop_reason: "refusal", content: [] });
    const reply = await generateChatReply([{ role: "user", content: "?" }], { onText: () => {} });
    expect(reply).toMatchObject({ stopReason: "refusal", text: "" });
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
