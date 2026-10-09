import Anthropic from "@anthropic-ai/sdk";
import type { MessageRole } from "@/types";
import { anthropic, CHAT_EFFORT, CHAT_MAX_TOKENS, CHAT_MODEL } from "./anthropic";
import { SYSTEM_PROMPT } from "./prompts";

/** Server-side refusal fallback: see the `fallbacks` comment in generateChatReply */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export interface ChatTurn {
  role: Extract<MessageRole, "user" | "assistant">;
  content: string;
}

export interface ChatReply {
  /** The full reply text — exactly what was streamed through onText */
  text: string;
  /** The model that wrote the reply (a fallback model if the requested one declined) */
  model: string;
  stopReason: Anthropic.Beta.BetaStopReason | null;
  /** Input (including cached) plus output tokens for the request that produced the reply */
  tokensUsed: number;
}

/**
 * Streams Claude's reply to a conversation, calling `onText` with each piece
 * of text as it arrives, and resolves with the complete reply.
 *
 * Rejects with the SDK's error types on API failures, and with
 * APIUserAbortError if `signal` aborts (e.g. the browser disconnected).
 */
export async function generateChatReply(
  turns: ChatTurn[],
  { onText, signal }: { onText: (text: string) => void; signal?: AbortSignal },
): Promise<ChatReply> {
  const stream = anthropic.beta.messages.stream(
    {
      model: CHAT_MODEL,
      max_tokens: CHAT_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: turns,
      output_config: { effort: CHAT_EFFORT },
      // Caches the conversation so far; the next turn re-reads it at a
      // fraction of the input price (short chats are below the minimum
      // cacheable size and simply aren't cached)
      cache_control: { type: "ephemeral" },
      // If a safety classifier declines the request, the API retries it on
      // the model Anthropic recommends for that kind of refusal, on the same
      // stream — so a false positive doesn't become a failed reply
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    },
    { signal },
  );

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      onText(event.delta.text);
    } else if (event.type === "content_block_start" && event.content_block.type === "fallback") {
      const { from, to } = event.content_block;
      console.info(`Chat reply fell back from ${from.model} to ${to.model}`);
    }
  }

  const message = await stream.finalMessage();
  const { usage } = message;
  return {
    // Text blocks only: thinking is never shown, and fallback blocks are markers.
    // After a mid-reply fallback the new model continues the partial text, so
    // joining the blocks gives the same text the user watched stream in.
    text: message.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join(""),
    model: message.model,
    stopReason: message.stop_reason,
    tokensUsed:
      usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      usage.output_tokens,
  };
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
