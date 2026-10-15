import { after } from "next/server";
import { describeChatError, generateChatReply } from "@/lib/ai/chat";
import { compactConversation } from "@/lib/ai/compaction";
import { COMPACT_AT_TOKENS } from "@/lib/ai/context";
import { buildRAGPrompt, imageOnlyQuestion } from "@/lib/ai/prompts";
import { type RetrievedContext, retrieveContext } from "@/lib/ai/rag";
import { SourceList } from "@/lib/ai/sources";
import { generateTitle } from "@/lib/ai/title";
import { createToolbox } from "@/lib/ai/tools";
import { historyImageBudget, toTurnImages, withHistoryImages } from "@/lib/ai/vision";
import { checkContentLength, jsonError, type ReadBodyResult, readJsonBody, withErrorHandling } from "@/lib/api";
import { getSession } from "@/lib/auth";
import {
  imageTooLargeMessage,
  MAX_IMAGE_SIZE,
  MAX_IMAGES_PER_MESSAGE,
  sanitizeImageName,
  UNSUPPORTED_IMAGE_MESSAGE,
} from "@/lib/chat/attachments";
import { type NewAttachment, type NormalizedImage, normalizeImage, storeImages } from "@/lib/chat/images";
import { type ExchangeToSave, getChatHistory, saveExchange } from "@/lib/chat/queries";
import { ndjsonLine } from "@/lib/chat/stream";
import { titleFromMessage } from "@/lib/chat/title";
import { firstIssueMessage, MAX_MESSAGE_LENGTH, sendMessageSchema } from "@/lib/chat/validation";
import { enforceRateLimit } from "@/lib/rate-limit";
import { deleteFilesQuietly } from "@/lib/storage";
import type { ChatStreamEvent } from "@/types";

// Room for the longest message even if every character takes 4 bytes in UTF-8
const MAX_BODY_BYTES = MAX_MESSAGE_LENGTH * 4 + 1024;

// A message with images: the images, the text, and room for the multipart
// boundaries and headers around them
const MAX_MULTIPART_BYTES = MAX_IMAGES_PER_MESSAGE * MAX_IMAGE_SIZE + MAX_BODY_BYTES + 64 * 1024;

const REFUSED_MESSAGE = "Claude can't help with that request. Try rephrasing it — your message wasn't saved.";
const EMPTY_REPLY_MESSAGE = "Claude didn't return a reply. Please try again.";
const RETRIEVAL_FAILED_MESSAGE = "Couldn't search your documents. Please try again.";

/** One line per question, so similarity thresholds can be tuned from real traffic */
function logRetrieval(conversationId: string, { mode, sources }: RetrievedContext) {
  const best = sources[0]?.similarity;
  const score = typeof best === "number" ? `, best similarity ${best.toFixed(3)}` : "";
  console.info(`Retrieval in ${conversationId}: ${mode}, ${sources.length} sources${score}`);
}

/**
 * The request body as an object for sendMessageSchema: JSON for a text
 * message, multipart/form-data for one with images (fields conversationId,
 * message and up to MAX_IMAGES_PER_MESSAGE files named "images").
 */
async function readSendBody(request: Request): Promise<ReadBodyResult> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    return readJsonBody(request, MAX_BODY_BYTES);
  }
  const lengthError = checkContentLength(request, MAX_MULTIPART_BYTES);
  if (lengthError) {
    return { ok: false, response: lengthError };
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, response: jsonError(400, "Expected a multipart/form-data body.") };
  }
  return {
    ok: true,
    body: {
      conversationId: form.get("conversationId"),
      message: form.get("message") ?? "",
      images: form.getAll("images"),
    },
  };
}

const UNUSABLE_IMAGE_RESPONSES = {
  unsupported: () => jsonError(415, UNSUPPORTED_IMAGE_MESSAGE),
  unreadable: (name: string) => jsonError(400, `${name} couldn't be read as an image. It may be damaged.`),
  too_large: (name: string) => jsonError(413, `${name} has too many pixels to process.`),
} as const;

/** Checks and re-encodes the uploaded images (images.ts), or returns the error response for the first bad one. */
async function prepareImages(
  files: readonly File[],
): Promise<{ ok: true; images: NormalizedImage[] } | { ok: false; response: Response }> {
  for (const file of files) {
    const name = sanitizeImageName(file.name);
    if (file.size === 0) {
      return { ok: false, response: jsonError(400, `${name} is empty.`) };
    }
    if (file.size > MAX_IMAGE_SIZE) {
      return { ok: false, response: jsonError(413, imageTooLargeMessage(name)) };
    }
  }
  const results = await Promise.all(
    files.map(async (file) => normalizeImage(new Uint8Array(await file.arrayBuffer()), sanitizeImageName(file.name))),
  );
  const images: NormalizedImage[] = [];
  for (const [i, result] of results.entries()) {
    if (!result.ok) {
      return { ok: false, response: UNUSABLE_IMAGE_RESPONSES[result.reason](sanitizeImageName(files[i].name)) };
    }
    images.push(result.image);
  }
  return { ok: true, images };
}

/**
 * Stores the message's images and saves the exchange. If saving fails, the
 * stored images are removed again, so no file is left without its message.
 */
async function saveExchangeWithImages(
  userId: string,
  images: readonly NormalizedImage[],
  exchange: Omit<ExchangeToSave, "user"> & { user: Omit<ExchangeToSave["user"], "attachments"> },
) {
  const attachments: NewAttachment[] = images.length > 0 ? await storeImages(userId, images) : [];
  try {
    return await saveExchange({ ...exchange, user: { ...exchange.user, attachments } });
  } catch (error) {
    await deleteFilesQuietly(attachments.map((attachment) => attachment.storageKey));
    throw error;
  }
}

/**
 * POST /api/chat — send a message and stream Claude's reply.
 * Body: `{ conversationId: string, message: string }` as JSON, or as
 * multipart/form-data with up to four image files under "images".
 *
 * This is the RAG pipeline end to end: find the passages of the chat's
 * documents that answer the message (retrieve), put them in front of the
 * question (augment), and stream Claude's answer (generate). While
 * answering, Claude can call tools to search again or read a page; their
 * progress streams as `tool` events.
 *
 * Problems with the request (auth, validation, unknown conversation) are
 * normal JSON error responses. Once the reply starts, the response is a
 * stream of newline-delimited JSON events (see ChatStreamEvent): text deltas,
 * then `done` with the saved messages, or `error`.
 *
 * Images go to Claude ahead of the text, and earlier images are sent again
 * (vision.ts), so follow-up questions about them work.
 *
 * The question and answer are saved together once the reply completes, with
 * the images. A failed, refused or abandoned reply saves nothing, so the user
 * can simply send the message again.
 *
 * The first message also names the chat (a small model writes the title
 * while Claude answers), and a conversation that has grown past its context
 * budget is summarized in the background once the response has finished.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const session = await getSession();
  if (!session) {
    return jsonError(401, "You must be signed in.");
  }
  const userId = session.user.id;
  // Before reading the body: images take real work to check
  const limited = enforceRateLimit(userId, "chat");
  if (limited) {
    return limited;
  }

  const read = await readSendBody(request);
  if (!read.ok) {
    return read.response;
  }
  const parsed = sendMessageSchema.safeParse(read.body);
  if (!parsed.success) {
    return jsonError(400, firstIssueMessage(parsed.error));
  }
  const { conversationId, message } = parsed.data;

  const history = await getChatHistory(userId, conversationId);
  if (!history) {
    // Also returned for other users' conversations, so IDs can't be probed
    return jsonError(404, "Conversation not found.");
  }
  const receivedAt = new Date();

  // Before the stream starts, so a bad image is a normal error response
  const prepared = await prepareImages(parsed.data.images);
  if (!prepared.ok) {
    return prepared.response;
  }
  const { images } = prepared;
  const turnImages = toTurnImages(images);

  // Stops generation (and token spend) when the browser goes away
  const generation = new AbortController();
  request.signal.addEventListener("abort", () => generation.abort());

  // Set by the stream if this reply took the conversation over its budget.
  // after() runs once the response has finished, so the summary is written
  // without anyone waiting for it.
  let needsCompaction = false;
  after(async () => {
    if (!needsCompaction) return;
    try {
      await compactConversation(conversationId);
    } catch (error) {
      console.error(`Compacting conversation ${conversationId} failed`, error);
    }
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        if (!generation.signal.aborted) {
          controller.enqueue(encoder.encode(ndjsonLine(event)));
        }
      };

      // Named alongside the reply, so the title costs no waiting time. Never
      // rejects; null means fall back to the message itself.
      const title = history.isEmpty ? generateTitle(message, { images: turnImages, signal: generation.signal }) : null;

      try {
        const documentIds = history.documents.map((document) => document.id);
        let context: RetrievedContext;
        try {
          // Images on their own leave nothing to search with
          context = await retrieveContext(message || null, documentIds, userId, { signal: generation.signal });
        } catch (error) {
          if (!generation.signal.aborted) {
            console.error(`Document search failed in conversation ${conversationId}`, error);
            send({ type: "error", error: RETRIEVAL_FAILED_MESSAGE });
          }
          return;
        }
        logRetrieval(conversationId, context);

        // Retrieval's passages are Sources 1..n; tools number theirs after
        const sources = new SourceList(context.sources);
        const toolbox = createToolbox({
          userId,
          documents: history.documents,
          sources,
          signal: generation.signal,
        });

        // Earlier images come along as far as the request size allows; this
        // message's own images always do
        const historyTurns = await withHistoryImages(
          history.turns,
          historyImageBudget(images.map((image) => ({ byteSize: image.data.byteLength }))),
        );
        const question = message || imageOnlyQuestion(images.length);

        // Only this turn carries passages; history replays the plain questions
        const reply = await generateChatReply(
          [
            ...historyTurns,
            {
              role: "user",
              content: buildRAGPrompt(question, context, history.documents),
              ...(turnImages.length > 0 && { images: turnImages }),
            },
          ],
          {
            compaction: history.compaction ?? undefined,
            toolbox,
            signal: generation.signal,
            onText: (text) => send({ type: "delta", text }),
            onToolCall: (call) => send({ type: "tool", call }),
            onRetry: ({ reason, delayMs }) => send({ type: "retry", reason, delayMs }),
          },
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

        const saved = await saveExchangeWithImages(userId, images, {
          conversationId,
          user: { content: message, createdAt: receivedAt },
          assistant: {
            content: reply.text,
            model: reply.model,
            usage: reply.usage,
            contextTokens: reply.contextTokens,
            createdAt: new Date(),
            retrieval: context.mode,
            sources: sources.all,
            toolCalls: reply.toolCalls,
          },
          title: title ? ((await title) ?? titleFromMessage(message || images[0].name)) : undefined,
        });
        send({ type: "done", ...saved });

        // Measured, not estimated: how many tokens Claude actually read for this
        // reply. The next reply reads all that again plus this exchange.
        needsCompaction = reply.contextTokens > COMPACT_AT_TOKENS;
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
});
