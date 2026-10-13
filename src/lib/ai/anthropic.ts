import Anthropic from "@anthropic-ai/sdk";

// Reads ANTHROPIC_API_KEY from the environment. The SDK retries 408/409/429/5xx
// and connection errors twice with backoff by default. Chat replies turn that
// off and retry themselves, so they can tell the user they're waiting (chat.ts).
export const anthropic = new Anthropic();

/** The model behind chat. Change it here and nowhere else. */
export const CHAT_MODEL = "claude-opus-5-5";

/**
 * How hard the model thinks before answering (thinking is always on for this
 * model; effort is the dial). Chat favours a fast first token, and "low"
 * holds up well for conversational Q&A — raise it if answers fall short.
 */
export const CHAT_EFFORT = "low";

/**
 * A ceiling, not a target: thinking counts toward it as well as the visible
 * reply, and hitting it cuts the answer off mid-sentence, so leave plenty of
 * room. Streaming keeps a high limit safe from HTTP timeouts.
 */
export const CHAT_MAX_TOKENS = 64_000;

/**
 * Names conversations. A six-word title doesn't need Opus: Haiku is a small,
 * fast model at a fraction of the price, and it runs alongside the reply.
 */
export const TITLE_MODEL = "claude-haiku-5-5";
