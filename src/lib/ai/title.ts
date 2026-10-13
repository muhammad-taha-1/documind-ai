import Anthropic from "@anthropic-ai/sdk";
import { cleanGeneratedTitle } from "@/lib/chat/title";
import { anthropic, TITLE_MODEL } from "./anthropic";

const TITLE_SYSTEM_PROMPT = `You name conversations for a sidebar list. Given the first message of a conversation with a document assistant, reply with a short title for it: at most 6 words, in the language of the message, with no quotes and no final punctuation. Reply with the title only.`;

/** The title is a nice-to-have: don't let a slow request hold up saving the reply */
const TITLE_TIMEOUT_MS = 15_000;

/**
 * A short title for a conversation, from its first message, or null if none
 * could be made (the caller falls back to the message itself). Never
 * rejects: a failed title isn't worth failing the reply over.
 *
 * Called alongside the reply rather than after it, so naming the chat adds
 * no waiting time.
 */
export async function generateTitle(firstMessage: string, { signal }: { signal?: AbortSignal } = {}) {
  try {
    const response = await anthropic.messages.create(
      {
        model: TITLE_MODEL,
        // Room for some thinking before the few words of the title; low effort
        // lets the model skip thinking for a task this simple
        max_tokens: 1024,
        output_config: { effort: "low" },
        system: TITLE_SYSTEM_PROMPT,
        // Tagged so the model treats it as material to name, not a request to answer
        messages: [{ role: "user", content: `<message>\n${firstMessage}\n</message>` }],
      },
      { signal, timeout: TITLE_TIMEOUT_MS, maxRetries: 1 },
    );
    if (response.stop_reason !== "end_turn") {
      // e.g. a refusal: there's no server-side fallback on this model
      console.warn(`Title generation stopped early: ${response.stop_reason}`);
      return null;
    }
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    return cleanGeneratedTitle(text);
  } catch (error) {
    if (!(error instanceof Anthropic.APIUserAbortError)) {
      console.error("Title generation failed", error);
    }
    return null;
  }
}
