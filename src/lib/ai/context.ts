import { z } from "zod";
import type { ChatTurn, CompactionBlock } from "./chat";

// Context window management: how much of a conversation Claude sees.
//
// Every request re-sends the conversation, so a long chat gets slower and
// more expensive with each message, and answers get worse as old, irrelevant
// turns pile up. Simply sending the last N messages (a sliding window) keeps
// it bounded, but the window moves every turn, so the start of the prompt
// changes every turn too, and the prompt cache (a prefix match) never hits.
//
// So instead: send everything until the conversation passes a token budget,
// then replace the older messages with a summary written by the API
// (compaction.ts). Between compactions the prompt only grows at the end, and
// every turn reads the conversation so far from the cache.

/**
 * Compact once a reply's prompt reaches this many tokens. Far below the
 * model's 1M-token window: the point is cost and focus, not fitting at all.
 */
export const COMPACT_AT_TOKENS = 50_000;

/** Exchanges (question + answer) kept word for word after the summary */
export const KEEP_RECENT_EXCHANGES = 2;

/**
 * The last line of defence, if compaction keeps failing: the most history
 * sent with a message, in characters (about 150k tokens at ~4 characters per
 * token). Measured usage drives compaction; this is only an estimate, which
 * is fine for a cap that should never be reached.
 */
export const MAX_HISTORY_CHARACTERS = 600_000;

/**
 * The newest turns that fit in `maxCharacters`, starting with a user turn.
 * Normally that's all of them; dropping the oldest is the fallback when
 * compaction hasn't kept the conversation small. Images have their own
 * budget (vision.ts), so only text counts here.
 */
export function fitHistory<Turn extends Pick<ChatTurn, "role" | "content">>(
  turns: Turn[],
  maxCharacters = MAX_HISTORY_CHARACTERS,
): Turn[] {
  let start = turns.length;
  let characters = 0;
  while (start > 0 && characters + turns[start - 1].content.length <= maxCharacters) {
    start--;
    characters += turns[start].content.length;
  }
  // The cut can land on an assistant reply; a conversation opens with the user
  while (start < turns.length && turns[start].role !== "user") {
    start++;
  }
  return turns.slice(start);
}

/**
 * Where to split a conversation for compaction: the index of the first
 * message to keep word for word (the start of the last `keep` exchanges), or
 * null if there's nothing older than that to summarize.
 *
 * The split always falls just before a user message, so the kept part opens
 * with a question, as a conversation must.
 */
export function findCompactionCut(messages: readonly { role: string }[], keep = KEEP_RECENT_EXCHANGES): number | null {
  let usersSeen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && ++usersSeen === keep) {
      return i > 0 ? i : null;
    }
  }
  return null;
}

// Loose: the block must go back exactly as the API returned it, fields we
// don't know about included, so nothing is stripped
const compactionBlockSchema = z.looseObject({
  type: z.literal("compaction"),
  content: z.string().min(1),
});

/** A stored compaction block, checked, or null if there is none or it's malformed. */
export function parseCompactionBlock(conversationId: string, value: unknown): CompactionBlock | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = compactionBlockSchema.safeParse(value);
  if (!parsed.success) {
    // Better to lose the summary (and fall back to trimming) than the chat
    console.error(`Conversation ${conversationId} has a malformed compaction block`, parsed.error);
    return null;
  }
  return parsed.data as CompactionBlock;
}
