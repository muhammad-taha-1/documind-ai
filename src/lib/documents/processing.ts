import { readFile } from "node:fs/promises";
import { DocumentStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { chunkPages } from "./chunker";
import { PdfParseError, parsePdf } from "./parser";
import { resolveStorageKey } from "./storage";

export const NO_TEXT_MESSAGE =
  "No extractable text — this PDF may be image-only (for example, a scan).";
const GENERIC_FAILURE_MESSAGE = "Processing failed. Please try again.";

// Processing can start from a fresh upload or as a retry after a failure
const STARTABLE_STATUSES: DocumentStatus[] = [DocumentStatus.UPLOADING, DocumentStatus.ERROR];

export type ClaimResult = "claimed" | "busy" | "not_found";

/**
 * Atomically moves the user's document into PROCESSING.
 *
 * A single conditional UPDATE means two concurrent requests (a double-clicked
 * Retry, say) can't both start the pipeline — only one sees `count === 1`.
 * Including `userId` in the WHERE clause doubles as the ownership check.
 */
export async function claimDocumentForProcessing(
  documentId: string,
  userId: string,
): Promise<ClaimResult> {
  const { count } = await prisma.document.updateMany({
    where: { id: documentId, userId, status: { in: STARTABLE_STATUSES } },
    data: { status: DocumentStatus.PROCESSING, errorMessage: null },
  });
  if (count === 1) {
    return "claimed";
  }
  const exists = await prisma.document.count({ where: { id: documentId, userId } });
  return exists ? "busy" : "not_found";
}

/**
 * Runs the pipeline for a document that's already been claimed:
 *   extract text (Phase 5) → chunk (Phase 6) → embed (Phase 7) → READY
 *
 * Runs in the background after the HTTP response, so it never throws —
 * failures are recorded on the document as status ERROR + errorMessage,
 * which the dashboard shows.
 */
export async function runProcessing(documentId: string): Promise<void> {
  try {
    const document = await prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { filePath: true },
    });

    const bytes = await readFile(resolveStorageKey(document.filePath));
    const parsed = await parsePdf(bytes);
    const chunks = chunkPages(parsed.pages);
    if (chunks.length === 0) {
      throw new PdfParseError(NO_TEXT_MESSAGE);
    }

    // One transaction, so the document never shows EMBEDDING with a partial
    // set of chunks. Deleting first gives retries a clean slate.
    await prisma.$transaction([
      prisma.documentChunk.deleteMany({ where: { documentId } }),
      prisma.documentChunk.createMany({
        data: chunks.map((chunk) => ({ ...chunk, documentId })),
      }),
      prisma.document.update({
        where: { id: documentId },
        data: {
          pageCount: parsed.pageCount,
          totalChunks: chunks.length,
          embeddedChunks: 0,
          status: DocumentStatus.EMBEDDING,
        },
      }),
    ]);

    // TODO(Phase 7): embed the chunks (bumping embeddedChunks per batch), then
    // move to READY.
  } catch (error) {
    // PdfParseErrors carry a user-facing message; anything else is unexpected
    // (DB down, file missing), so log it and show a generic message instead
    const isExpected = error instanceof PdfParseError;
    if (!isExpected) {
      console.error(`Processing failed for document ${documentId}`, error);
    }
    await prisma.document
      .update({
        where: { id: documentId },
        data: {
          status: DocumentStatus.ERROR,
          errorMessage: isExpected ? error.message : GENERIC_FAILURE_MESSAGE,
        },
      })
      .catch((updateError: unknown) => {
        // e.g. the document was deleted mid-processing
        console.error(`Could not record failure for document ${documentId}`, updateError);
      });
  }
}
