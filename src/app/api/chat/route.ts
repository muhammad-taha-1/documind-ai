import { describeChatError, generateChatReply } from "@/lib/ai/chat";
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

/**
 * POST /api/chat — send a message and stream Claude's reply.
 * Body: `{ conversationId: string, message: string }`
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

  const history = await getChatHistory(session.user.id, conversationId);
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
        const reply = await generateChatReply(
          [...history.turns, { role: "user", content: message }],
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
