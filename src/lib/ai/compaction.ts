import Anthropic from "@anthropic-ai/sdk";
import { getCompactionState, saveCompaction } from "@/lib/chat/queries";
import { anthropic, CHAT_EFFORT, CHAT_MODEL } from "./anthropic";
import { COMPACTION_BETA, usageOf } from "./chat";
import { findCompactionCut } from "./context";
import { RAG_SYSTEM_PROMPT } from "./prompts";
import { TOOLS } from "./tools";

// Compaction: replacing a conversation's older messages with a summary (see
// context.ts for why). The API writes the summary: a request with the
// `compaction` parameter returns a compaction block — readable summary text
// plus a signature — instead of a reply. From then on the block goes first
// in every request, in place of the messages it covers.
//
// It runs in the background after a reply, so nobody waits for it. Turns
// taken meanwhile simply come after the summarized range, which is fine.

/** Covers the summary and any thinking before it */
const COMPACTION_MAX_TOKENS = 16_000;

/**
 * Replaces the API's default summarization prompt, to keep what matters in a
 * document Q&A. Source numbers are only meaningful within one reply, so the
 * summary has to cite documents and pages instead.
 */
export const COMPACTION_INSTRUCTIONS = `Summarize this conversation so far, so it can continue without the earlier messages. It is a conversation between a user and DocuMind, an assistant that answers questions about documents the user has uploaded.

Keep:
- What the user is trying to achieve, and any preferences they stated (format, level of detail, language).
- Each question asked and the substance of the answer, with the specific facts, figures and names from the documents. Cite them by document title and page number, not by "[Source N]" labels, which won't mean anything later.
- Conclusions reached, and anything left unresolved or promised for later.

Leave out greetings and repetition. Write in the conversation's language, as concise prose or short bullet points. Do not call tools; reply with the summary only.`;

/** Conversations being compacted by this server right now, so one isn't summarized twice at once */
const inProgress = new Set<string>();

export type CompactionOutcome = "compacted" | "nothing_to_compact" | "no_summary" | "superseded";

/**
 * Summarizes a conversation's older messages, keeping the last few exchanges
 * word for word (KEEP_RECENT_EXCHANGES), and stores the summary. An existing
 * summary is summarized again along with the messages after it.
 *
 * Rejects only on API or database errors; the caller logs them. Without a
 * summary the conversation simply carries on uncompacted, and the next
 * reply tries again.
 */
export async function compactConversation(conversationId: string): Promise<CompactionOutcome> {
  if (inProgress.has(conversationId)) {
    return "superseded";
  }
  inProgress.add(conversationId);
  try {
    const state = await getCompactionState(conversationId);
    if (!state) {
      return "nothing_to_compact"; // Deleted in the meantime
    }
    const cut = findCompactionCut(state.messages);
    if (cut === null) {
      return "nothing_to_compact";
    }
    const older = state.messages.slice(0, cut);

    const response = await anthropic.beta.messages.create({
      model: CHAT_MODEL,
      max_tokens: COMPACTION_MAX_TOKENS,
      // The same system prompt and tools as the chat: the summarizer reads them
      system: RAG_SYSTEM_PROMPT,
      tools: [...TOOLS],
      output_config: { effort: CHAT_EFFORT },
      betas: [COMPACTION_BETA],
      // Everything sent is summarized, so send only what's being replaced:
      // the old summary (if any) and the messages after it, up to the cut
      messages: [
        ...(state.compaction ? [{ role: "assistant" as const, content: [state.compaction] }] : []),
        ...older.map(({ role, content }) => ({ role, content })),
      ],
      compaction: { type: "summarize", instructions: COMPACTION_INSTRUCTIONS },
    });

    const { inputTokens, outputTokens, cacheReadTokens } = usageOf(response.usage);
    // The summary comes back alone, with its own stop reason. Anything else
    // (max_tokens, refusal, a tool call) means no summary this time.
    const block = response.content.find(
      (item): item is Anthropic.Beta.BetaCompactionBlock => item.type === "compaction",
    );
    if (response.stop_reason !== "compaction" || !block?.content) {
      console.warn(`Compaction of ${conversationId} produced no summary (stop reason: ${response.stop_reason})`);
      return "no_summary";
    }

    const saved = await saveCompaction(conversationId, {
      block,
      through: older.at(-1)!.createdAt,
      expectedThrough: state.compactedThrough,
    });
    if (!saved) {
      return "superseded";
    }
    console.info(
      `Compacted ${conversationId}: ${older.length} messages into a ${block.content.length}-character summary ` +
        `(${inputTokens + cacheReadTokens} tokens in, ${outputTokens} out)`,
    );
    return "compacted";
  } finally {
    inProgress.delete(conversationId);
  }
}
