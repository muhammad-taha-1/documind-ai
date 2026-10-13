import Anthropic from "@anthropic-ai/sdk";
import type { MessageRole, RetryReason, TokenUsage, ToolCall } from "@/types";
import { anthropic, CHAT_EFFORT, CHAT_MAX_TOKENS, CHAT_MODEL } from "./anthropic";
import { RAG_SYSTEM_PROMPT } from "./prompts";

/** Server-side refusal fallback: see the `fallbacks` comment in generateChatReply */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * On-demand compaction (context.ts). Required on every request that carries
 * a compaction block, so chat requests always send it: a header that comes
 * and goes is one more thing that differs between requests.
 */
export const COMPACTION_BETA = "compact-2026-09-04";

/**
 * Rounds of tool calls in one reply before Claude has to answer with what it
 * has. A guard against a runaway loop: real questions need one or two.
 */
export const MAX_TOOL_ROUNDS = 5;

/** Times a request is retried when Claude is busy, before giving up */
export const MAX_RETRIES = 3;

/** First retry waits about this long; each one after waits twice as long */
const BASE_RETRY_DELAY_MS = 1_000;

/** If the API asks us to wait longer than this, give up and let the user retry */
const MAX_RETRY_DELAY_MS = 30_000;

/** Sent to Claude when a tool throws, instead of the error itself */
const TOOL_CRASHED = "The tool failed unexpectedly. Try another approach, or answer without it.";

type BetaMessageParam = Anthropic.Beta.BetaMessageParam;

/** The API's summary of older messages, sent back exactly as it was returned (context.ts) */
export type CompactionBlock = Anthropic.Beta.BetaCompactionBlockParam;

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
  /** Tokens used across every request in the reply (tool rounds, fallbacks, retries that got a response) */
  usage: TokenUsage;
  /** The whole prompt of the first request: how big the conversation is, as Claude counts it */
  contextTokens: number;
  /** The tools Claude used, in the order it called them */
  toolCalls: ToolCall[];
}

export interface RetryNotice {
  reason: RetryReason;
  delayMs: number;
}

const NO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/**
 * Everything one response used. Its top-level usage covers only the attempt
 * that produced the message; after a refusal fallback, `iterations` lists
 * every attempt (the declined one too), so that's the one to sum.
 */
export function usageOf(usage: Anthropic.Beta.BetaUsage): TokenUsage {
  const attempts = usage.iterations?.length ? usage.iterations : [usage];
  return attempts.reduce<TokenUsage>(
    (total, attempt) =>
      addUsage(total, {
        inputTokens: attempt.input_tokens,
        outputTokens: attempt.output_tokens,
        cacheReadTokens: attempt.cache_read_input_tokens ?? 0,
        cacheWriteTokens: attempt.cache_creation_input_tokens ?? 0,
      }),
    NO_USAGE,
  );
}

/**
 * A request's whole prompt. With caching, `input_tokens` counts only what
 * came after the last cache breakpoint, so the cached parts are added back.
 */
function promptTokens(usage: Anthropic.Beta.BetaUsage): number {
  return usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
}

/** Why a failed request is worth another try, or null if it isn't */
function retryReason(error: unknown): RetryReason | null {
  if (!(error instanceof Anthropic.APIError) || error instanceof Anthropic.APIUserAbortError) {
    return null;
  }
  // The API can say outright that a retry won't help
  if (error.headers?.get("x-should-retry") === "false") {
    return null;
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "rate_limited";
  }
  // Includes timeouts. A mid-stream error event has no status, so it isn't retried.
  if (error instanceof Anthropic.APIConnectionError) {
    return "unavailable";
  }
  const { status } = error;
  // 408 timeout, 409 conflict, 5xx including 529 "overloaded" — the same set the SDK retries
  return status === 408 || status === 409 || (status !== undefined && status >= 500) ? "unavailable" : null;
}

/** The wait the API asked for (retry-after-ms, or retry-after in seconds or as a date), if any */
function requestedDelay(headers: Headers | undefined): number | null {
  const milliseconds = Number.parseFloat(headers?.get("retry-after-ms") ?? "");
  if (Number.isFinite(milliseconds) && milliseconds >= 0) {
    return Math.ceil(milliseconds);
  }
  const retryAfter = headers?.get("retry-after");
  if (!retryAfter) {
    return null;
  }
  const seconds = Number.parseFloat(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }
  const date = Date.parse(retryAfter);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/**
 * How long to wait before retry number `attempt` (0-based): what the API
 * asked for, or exponential backoff (~1s, 2s, 4s) with jitter, so clients
 * that failed together don't all come back at the same moment.
 */
export function retryDelay(error: unknown, attempt: number): number {
  const requested = error instanceof Anthropic.APIError ? requestedDelay(error.headers) : null;
  if (requested !== null) {
    return requested;
  }
  const base = BASE_RETRY_DELAY_MS * 2 ** attempt;
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Anthropic.APIUserAbortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Anthropic.APIUserAbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs `request`, retrying with backoff while Claude is busy. Only retries
 * when `canRetry()` says nothing reached the user yet: text already shown
 * can't be taken back, so a reply that fails halfway fails.
 */
async function withRetries<T>(
  request: () => Promise<T>,
  {
    canRetry,
    onRetry,
    signal,
  }: { canRetry: () => boolean; onRetry?: (notice: RetryNotice) => void; signal?: AbortSignal },
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      const reason = attempt < MAX_RETRIES && canRetry() && !signal?.aborted ? retryReason(error) : null;
      const delayMs = reason ? retryDelay(error, attempt) : null;
      if (!reason || delayMs === null || delayMs > MAX_RETRY_DELAY_MS) {
        throw error;
      }
      onRetry?.({ reason, delayMs });
      await sleep(delayMs, signal);
    }
  }
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
 * The conversation as API messages: the summary of older messages first (if
 * it has been compacted), then the turns, with a cache breakpoint at the end
 * of the conversation so far (the turn before the new question). The next
 * request starts with exactly that prefix, so it reads it from the cache. The
 * new question isn't cached: it carries passages retrieved for it alone,
 * which are never sent again, so caching it would pay the write premium for
 * nothing.
 */
function toCachedMessages(turns: ChatTurn[], compaction: CompactionBlock | undefined): BetaMessageParam[] {
  const messages: BetaMessageParam[] = [
    // The block must come first; it takes the place of the messages it summarizes
    ...(compaction ? [{ role: "assistant" as const, content: [compaction] }] : []),
    ...turns,
  ];
  const lastHistoryMessage = messages.length - 2;
  return messages.map((message, i) => (i === lastHistoryMessage ? withCacheBreakpoint(message) : message));
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

/**
 * Streams Claude's reply to a conversation, calling `onText` with each piece
 * of text as it arrives, and resolves with the complete reply.
 *
 * With a toolbox, this is the tool loop: when Claude asks for tools, run
 * them, send back the results, and let it continue, until it answers (or
 * runs out of rounds). `onToolCall` hears each call start and finish.
 *
 * `compaction` is the summary of the messages before `turns`, if the
 * conversation has been compacted (context.ts).
 *
 * When Claude is busy (429, 5xx) before any text has streamed, waits and
 * tries again, telling `onRetry` how long it's waiting.
 *
 * Rejects with the SDK's error types on API failures, and with
 * APIUserAbortError if `signal` aborts (e.g. the browser disconnected).
 */
export async function generateChatReply(
  turns: ChatTurn[],
  {
    compaction,
    onText,
    onToolCall,
    onRetry,
    toolbox,
    signal,
  }: {
    compaction?: CompactionBlock;
    onText: (text: string) => void;
    onToolCall?: (call: ToolCall) => void;
    onRetry?: (notice: RetryNotice) => void;
    toolbox?: Toolbox;
    signal?: AbortSignal;
  },
): Promise<ChatReply> {
  // Grows by one assistant reply and one set of tool results per round. It's
  // only ever appended to: Claude's thinking is tied to the exact
  // conversation it was produced in, so earlier messages must not change.
  const messages = toCachedMessages(turns, compaction);
  const toolCalls: ToolCall[] = [];
  let text = "";
  let usage = NO_USAGE;
  let contextTokens = 0;

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

  /** One request: streams its text and resolves with the final message */
  async function streamRound(requestMessages: BetaMessageParam[], lastRound: boolean) {
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
        betas: [FALLBACK_BETA, COMPACTION_BETA],
        fallbacks: "default",
        ...(toolbox && {
          tools: [...toolbox.definitions],
          // Out of rounds: Claude must answer with what it has. (This model
          // can't be forced to call a tool, but it can be stopped from it.)
          ...(lastRound && { tool_choice: { type: "none" as const } }),
        }),
      },
      // withRetries does the retrying, so it can tell the user
      { signal, maxRetries: 0 },
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
    return stream.finalMessage();
  }

  for (let round = 0; ; round++) {
    const lastRound = round === MAX_TOOL_ROUNDS;
    // From the second round on, also cache the end of the conversation so
    // far: the next round re-sends all of it, passages and tool results included
    // (a copy either way: `messages` keeps growing after the request is sent)
    const requestMessages =
      round === 0 ? [...messages] : [...messages.slice(0, -1), withCacheBreakpoint(messages.at(-1)!)];

    const textBefore = text.length;
    const message = await withRetries(() => streamRound(requestMessages, lastRound), {
      canRetry: () => text.length === textBefore,
      onRetry,
      signal,
    });
    usage = addUsage(usage, usageOf(message.usage));
    if (round === 0) {
      contextTokens = promptTokens(message.usage);
    }

    // Anything else is final: end_turn, max_tokens (never run a call that may
    // have been cut off), refusal (the caller handles it)
    if (!toolbox || message.stop_reason !== "tool_use" || lastRound) {
      return { text, model: message.model, stopReason: message.stop_reason, usage, contextTokens, toolCalls };
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
