import Anthropic from "@anthropic-ai/sdk";
import type { MessageRole, ToolCall } from "@/types";
import { anthropic, CHAT_EFFORT, CHAT_MAX_TOKENS, CHAT_MODEL } from "./anthropic";
import { RAG_SYSTEM_PROMPT } from "./prompts";

/** Server-side refusal fallback: see the `fallbacks` comment in generateChatReply */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Rounds of tool calls in one reply before Claude has to answer with what it
 * has. A guard against a runaway loop: real questions need one or two.
 */
export const MAX_TOOL_ROUNDS = 5;

/** Sent to Claude when a tool throws, instead of the error itself */
const TOOL_CRASHED = "The tool failed unexpectedly. Try another approach, or answer without it.";

type BetaMessageParam = Anthropic.Beta.BetaMessageParam;

export interface ChatTurn {
  role: Extract<MessageRole, "user" | "assistant">;
  content: string;
}

export interface ToolOutput {
  /** The text Claude reads */
  output: string;
  /** Tells Claude the call failed (bad input, missing document), so it can correct course */
  isError: boolean;
}

/** The tools Claude may call while replying (implemented in tools.ts) */
export interface Toolbox {
  definitions: readonly Anthropic.Beta.BetaTool[];
  /** What a call does, in words for the UI */
  describe(name: string, input: unknown): string;
  /** Runs a call. Problems Claude can fix come back as `isError`; rejects only on unexpected failures. */
  run(name: string, input: unknown): Promise<ToolOutput>;
}

export interface ChatReply {
  /** The full reply text — exactly what was streamed through onText */
  text: string;
  /** The model that wrote the reply (a fallback model if the requested one declined) */
  model: string;
  stopReason: Anthropic.Beta.BetaStopReason | null;
  /** Input (including cached) plus output tokens, across every request in the reply */
  tokensUsed: number;
  /** The tools Claude used, in the order it called them */
  toolCalls: ToolCall[];
}

/** Adds a cache breakpoint to the last content block of a message. */
function withCacheBreakpoint(message: BetaMessageParam): BetaMessageParam {
  const blocks =
    typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
  return {
    role: message.role,
    content: blocks.map((block, i) =>
      i === blocks.length - 1 ? { ...block, cache_control: { type: "ephemeral" as const } } : block,
    ),
  };
}

/**
 * The turns as API messages, with a cache breakpoint at the end of the
 * conversation so far (the turn before the new question). The next request
 * starts with exactly that prefix, so it reads it from the cache. The new
 * question isn't cached: it carries passages retrieved for it alone, which
 * are never sent again, so caching it would pay the write premium for nothing.
 */
function toCachedMessages(turns: ChatTurn[]): BetaMessageParam[] {
  const lastHistoryTurn = turns.length - 2;
  return turns.map((turn, i) => (i === lastHistoryTurn ? withCacheBreakpoint(turn) : turn));
}

/**
 * A reply's content as it has to be sent back on the next request. After a
 * mid-reply fallback, everything the declined model produced before the
 * switch except its text is invalid to send back (its tool calls were never
 * made); the fallback block itself is only a marker.
 */
function contentToSendBack(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaContentBlock[] {
  const boundary = content.findLastIndex((block) => block.type === "fallback");
  if (boundary === -1) {
    return content;
  }
  return [...content.slice(0, boundary).filter((block) => block.type === "text"), ...content.slice(boundary + 1)];
}

function totalTokens(usage: Anthropic.Beta.BetaUsage): number {
  return (
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    usage.output_tokens
  );
}

/**
 * Streams Claude's reply to a conversation, calling `onText` with each piece
 * of text as it arrives, and resolves with the complete reply.
 *
 * With a toolbox, this is the tool loop: when Claude asks for tools, run
 * them, send back the results, and let it continue, until it answers (or
 * runs out of rounds). `onToolCall` hears each call start and finish.
 *
 * Rejects with the SDK's error types on API failures, and with
 * APIUserAbortError if `signal` aborts (e.g. the browser disconnected).
 */
export async function generateChatReply(
  turns: ChatTurn[],
  {
    onText,
    onToolCall,
    toolbox,
    signal,
  }: {
    onText: (text: string) => void;
    onToolCall?: (call: ToolCall) => void;
    toolbox?: Toolbox;
    signal?: AbortSignal;
  },
): Promise<ChatReply> {
  // Grows by one assistant reply and one set of tool results per round. It's
  // only ever appended to: Claude's thinking is tied to the exact
  // conversation it was produced in, so earlier messages must not change.
  const messages = toCachedMessages(turns);
  const toolCalls: ToolCall[] = [];
  let text = "";
  let tokensUsed = 0;

  const emit = (piece: string) => {
    text += piece;
    onText(piece);
  };

  async function runTool(call: Anthropic.Beta.BetaToolUseBlock, box: Toolbox) {
    const index = toolCalls.length;
    const started: ToolCall = {
      id: call.id,
      name: call.name,
      input: call.input,
      label: box.describe(call.name, call.input),
      status: "running",
      output: null,
    };
    toolCalls.push(started);
    onToolCall?.(started);

    let result: ToolOutput;
    try {
      result = await box.run(call.name, call.input);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.error(`Tool ${call.name} failed`, error);
      result = { output: TOOL_CRASHED, isError: true };
    }

    const finished: ToolCall = { ...started, status: result.isError ? "failed" : "done", output: result.output };
    toolCalls[index] = finished;
    onToolCall?.(finished);
    return {
      type: "tool_result" as const,
      tool_use_id: call.id,
      content: result.output,
      ...(result.isError && { is_error: true }),
    };
  }

  for (let round = 0; ; round++) {
    const lastRound = round === MAX_TOOL_ROUNDS;
    // From the second round on, also cache the end of the conversation so
    // far: the next round re-sends all of it, passages and tool results included
    // (a copy either way: `messages` keeps growing after the request is sent)
    const requestMessages =
      round === 0 ? [...messages] : [...messages.slice(0, -1), withCacheBreakpoint(messages.at(-1)!)];

    const stream = anthropic.beta.messages.stream(
      {
        model: CHAT_MODEL,
        max_tokens: CHAT_MAX_TOKENS,
        system: RAG_SYSTEM_PROMPT,
        // Prefixes below the minimum cacheable size (512 tokens on this model)
        // simply aren't cached, so short chats pay nothing extra
        messages: requestMessages,
        output_config: { effort: CHAT_EFFORT },
        // If a safety classifier declines the request, the API retries it on
        // the model Anthropic recommends for that kind of refusal, on the same
        // stream — so a false positive doesn't become a failed reply
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        ...(toolbox && {
          tools: [...toolbox.definitions],
          // Out of rounds: Claude must answer with what it has. (This model
          // can't be forced to call a tool, but it can be stopped from it.)
          ...(lastRound && { tool_choice: { type: "none" as const } }),
        }),
      },
      { signal },
    );

    // Text from an earlier round (e.g. "Let me check") needs a break before this round's
    let needsBreak = text.length > 0 && !/\s$/.test(text);
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        if (needsBreak) {
          emit("\n\n");
          needsBreak = false;
        }
        emit(event.delta.text);
      } else if (event.type === "content_block_start" && event.content_block.type === "fallback") {
        const { from, to } = event.content_block;
        console.info(`Chat reply fell back from ${from.model} to ${to.model}`);
      }
    }

    const message = await stream.finalMessage();
    tokensUsed += totalTokens(message.usage);

    // Anything else is final: end_turn, max_tokens (never run a call that may
    // have been cut off), refusal (the caller handles it)
    if (!toolbox || message.stop_reason !== "tool_use" || lastRound) {
      return { text, model: message.model, stopReason: message.stop_reason, tokensUsed, toolCalls };
    }

    const content = contentToSendBack(message.content);
    const calls = content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use",
    );
    // Claude can ask for several tools at once; run them together. Every call
    // needs its result, all in one message, or the next request is rejected.
    const results = await Promise.all(calls.map((call) => runTool(call, toolbox)));
    messages.push({ role: "assistant", content }, { role: "user", content: results });
  }
}

/**
 * Turns a failure from generateChatReply into a message for the user, and
 * says whether it's worth logging (problems on our side, not transient load).
 */
export function describeChatError(error: unknown): { message: string; log: boolean } {
  // Most specific first: these are all APIError subclasses
  if (error instanceof Anthropic.RateLimitError) {
    return { message: "Claude is handling a lot of requests right now. Please try again in a moment.", log: false };
  }
  if (error instanceof Anthropic.InternalServerError) {
    // 5xx, including 529 "overloaded"
    return { message: "Claude is temporarily unavailable. Please try again in a moment.", log: true };
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return { message: "The AI service isn't configured correctly. Please contact the site owner.", log: true };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    // Our server couldn't reach the API (including timeouts) — not the user's connection
    return { message: "Couldn't reach Claude. Please try again.", log: true };
  }
  return { message: "Something went wrong while generating a reply. Please try again.", log: true };
}
