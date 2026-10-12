import { describeChatError, generateChatReply } from "@/lib/ai/chat";
import { buildRAGPrompt } from "@/lib/ai/prompts";
import { type RetrievedContext, retrieveContext } from "@/lib/ai/rag";
import { jsonError, readJsonBody } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { getChatHistory, saveExchange } from "@/lib/chat/queries";
import { ndjsonLine } from "@/lib/chat/stream";
import { titleFromMessage } from "@/lib/chat/title";
import { firstIssueMessage, MAX_MESSAGE_LENGTH, sendMessageSchema } from "@/lib/chat/validation";
import type { ChatStreamEvent } from "@/types";

// Room for the longest message even if every character takes 4 bytes in UTF-8
const MAX_BODY_BYTES = MAX_MESSAGE_LENGTH * 4 + 1024;

const REFUSED_MESSAGE =
  "Claude can't help with that request. Try rephrasing it — your message wasn't saved.";
const EMPTY_REPLY_MESSAGE = "Claude didn't return a reply. Please try again.";
const RETRIEVAL_FAILED_MESSAGE = "Couldn't search your documents. Please try again.";

/** One line per question, so similarity thresholds can be tuned from real traffic */
function logRetrieval(conversationId: string, { mode, sources }: RetrievedContext) {
  const best = sources[0]?.similarity;
  const score = typeof best === "number" ? `, best similarity ${best.toFixed(3)}` : "";
  console.info(`Retrieval in ${conversationId}: ${mode}, ${sources.length} sources${score}`);
}

/**
 * POST /api/chat — send a message and stream Claude's reply.
 * Body: `{ conversationId: string, message: string }`
 *
 * This is the RAG pipeline end to end: find the passages of the chat's
 * documents that answer the message (retrieve), put them in front of the
 * question (augment), and stream Claude's answer (generate).
 *
 * Problems with the request (auth, validation, unknown conversation) are
 * normal JSON error responses. Once the reply starts, the response is a
 * stream of newline-delimited JSON events (see ChatStreamEvent): text deltas,
 * then `done` with the saved messages, or `error`.
 *
 * The question and answer are saved together once the reply completes. A
 * failed, refused or abandoned reply saves nothing, so the user can simply
 * send the message again.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return jsonError(401, "You must be signed in.");
  }

  const json = await readJsonBody(request, MAX_BODY_BYTES);
  if (!json.ok) {
    return json.response;
  }
  const parsed = sendMessageSchema.safeParse(json.body);
  if (!parsed.success) {
    return jsonError(400, firstIssueMessage(parsed.error));
  }
  const { conversationId, message } = parsed.data;
  const userId = session.user.id;

  const history = await getChatHistory(userId, conversationId);
  if (!history) {
    // Also returned for other users' conversations, so IDs can't be probed
    return jsonError(404, "Conversation not found.");
  }
  const receivedAt = new Date();

  // Stops generation (and token spend) when the browser goes away
  const generation = new AbortController();
  request.signal.addEventListener("abort", () => generation.abort());

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        if (!generation.signal.aborted) {
          controller.enqueue(encoder.encode(ndjsonLine(event)));
        }
      };

      try {
        let context: RetrievedContext;
        try {
          context = await retrieveContext(message, history.documentIds, userId, {
            signal: generation.signal,
          });
        } catch (error) {
          if (!generation.signal.aborted) {
            console.error(`Document search failed in conversation ${conversationId}`, error);
            send({ type: "error", error: RETRIEVAL_FAILED_MESSAGE });
          }
          return;
        }
        logRetrieval(conversationId, context);

        // Only this turn carries passages; history replays the plain questions
        const reply = await generateChatReply(
          [...history.turns, { role: "user", content: buildRAGPrompt(message, context) }],
          { signal: generation.signal, onText: (text) => send({ type: "delta", text }) },
        );

        // Not saved: resending a declined message with every later turn
        // could get the rest of the conversation declined too
        if (reply.stopReason === "refusal") {
          send({ type: "error", error: REFUSED_MESSAGE });
          return;
        }
        if (!reply.text.trim()) {
          console.error(`Empty chat reply (stop reason: ${reply.stopReason}) in ${conversationId}`);
          send({ type: "error", error: EMPTY_REPLY_MESSAGE });
          return;
        }
        if (reply.stopReason === "max_tokens") {
          console.warn(`Chat reply hit the token limit in ${conversationId}`);
        }

        const saved = await saveExchange({
          conversationId,
          user: { content: message, createdAt: receivedAt },
          assistant: {
            content: reply.text,
            model: reply.model,
            tokensUsed: reply.tokensUsed,
            createdAt: new Date(),
            retrieval: context.mode,
            sources: context.sources,
          },
          title: history.isEmpty ? titleFromMessage(message) : undefined,
        });
        send({ type: "done", ...saved });
      } catch (error) {
        if (generation.signal.aborted) {
          return; // The browser left; there's no one to tell
        }
        const { message: userMessage, log } = describeChatError(error);
        if (log) {
          console.error(`Chat reply failed in conversation ${conversationId}`, error);
        }
        send({ type: "error", error: userMessage });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed because the browser cancelled the stream
        }
      }
    },
    cancel() {
      generation.abort();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Deliver each line as it's written: no caching or proxy buffering
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
