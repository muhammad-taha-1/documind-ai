import { DocumentStatus } from "@/generated/prisma/enums";
import { describeEmbeddingError } from "@/lib/ai/embeddings";
import { prisma } from "@/lib/db/prisma";
import { readStoredFile } from "@/lib/storage";
import { chunkPages, type TextChunk } from "./chunker";
import { embedDocumentChunks } from "./embedding";
import { PdfParseError, parsePdf } from "./parser";

export const NO_TEXT_MESSAGE = "No extractable text — this PDF may be image-only (for example, a scan).";
export const MISSING_FILE_MESSAGE = "The uploaded file is missing. Delete this document and upload it again.";
export const INTERRUPTED_MESSAGE =
  "Processing was interrupted because the server restarted. Retry to process it again.";
const GENERIC_FAILURE_MESSAGE = "Processing failed. Please try again.";

// Processing can start from a fresh upload or as a retry after a failure
const STARTABLE_STATUSES: DocumentStatus[] = [DocumentStatus.UPLOADING, DocumentStatus.ERROR];

// Stages that only last while this server is working on the document
const IN_PROGRESS_STATUSES: DocumentStatus[] = [
  DocumentStatus.UPLOADING,
  DocumentStatus.PROCESSING,
  DocumentStatus.EMBEDDING,
];

/**
 * Chunks are inserted this many at a time, one batch after another. One
 * createMany for a huge document makes Prisma split it and run the parts at
 * once on the transaction's single connection, which pg deprecates.
 */
const CHUNK_INSERT_BATCH_SIZE = 1000;

/** Room for the biggest documents' inserts (the default interactive transaction timeout is 5 s) */
const CHUNK_TRANSACTION_TIMEOUT_MS = 60_000;

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export type ClaimResult = "claimed" | "busy" | "not_found";

/**
 * Marks documents that were mid-processing as failed, so they can be retried.
 * Called once when the server starts (instrumentation.ts): processing runs
 * inside the server process, so anything still in progress then belongs to
 * a server that's gone, and would otherwise spin forever. Assumes a single
 * server, as the rest of the app does (rate-limit.ts).
 *
 * Failed, not restarted: if a document crashed the server, restarting it
 * on every boot would crash the server again. Returns how many were marked.
 *
 * `userIds` limits it to those users' documents: tests use it, since they
 * share the database with the app.
 */
export async function recoverInterruptedProcessing({ userIds }: { userIds?: string[] } = {}): Promise<number> {
  const { count } = await prisma.document.updateMany({
    where: { status: { in: IN_PROGRESS_STATUSES }, ...(userIds && { userId: { in: userIds } }) },
    data: { status: DocumentStatus.ERROR, errorMessage: INTERRUPTED_MESSAGE },
  });
  return count;
}

/**
 * Atomically moves the user's document into PROCESSING.
 *
 * A single conditional UPDATE means two concurrent requests (a double-clicked
 * Retry, say) can't both start the pipeline — only one sees `count === 1`.
 * Including `userId` in the WHERE clause doubles as the ownership check.
 */
export async function claimDocumentForProcessing(documentId: string, userId: string): Promise<ClaimResult> {
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
 * Replaces a document's chunks and moves it to EMBEDDING, all in one
 * transaction, so it never shows EMBEDDING with a partial set of chunks.
 * Deleting first gives retries a clean slate.
 */
export async function storeChunks(documentId: string, chunks: readonly TextChunk[], pageCount: number): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.documentChunk.deleteMany({ where: { documentId } });
      // One batch at a time: queries on a transaction share one connection
      for (let start = 0; start < chunks.length; start += CHUNK_INSERT_BATCH_SIZE) {
        await tx.documentChunk.createMany({
          data: chunks.slice(start, start + CHUNK_INSERT_BATCH_SIZE).map((chunk) => ({ ...chunk, documentId })),
        });
      }
      await tx.document.update({
        where: { id: documentId },
        data: { pageCount, totalChunks: chunks.length, embeddedChunks: 0, status: DocumentStatus.EMBEDDING },
      });
    },
    { timeout: CHUNK_TRANSACTION_TIMEOUT_MS },
  );
}

/**
 * Runs the pipeline for a document that's already been claimed:
 *   extract text (Phase 5) → chunk (Phase 6) → embed (Phase 7) → READY
 *
 * A retry starts again from the PDF: re-chunking replaces the old chunks,
 * embeddings and all, so a half-finished attempt leaves nothing behind.
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

    const bytes = await readStoredFile(document.filePath);
    const parsed = await parsePdf(bytes);
    const chunks = chunkPages(parsed.pages);
    if (chunks.length === 0) {
      throw new PdfParseError(NO_TEXT_MESSAGE);
    }

    await storeChunks(documentId, chunks, parsed.pageCount);
    await embedDocumentChunks(documentId);

    await prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.READY },
    });
  } catch (error) {
    // Deleting a document mid-run makes the next step fail (file gone, rows
    // gone). That's the user's choice, not an error, and there's nothing to record.
    const remaining = await prisma.document.count({ where: { id: documentId } }).catch(() => 1);
    if (remaining === 0) {
      console.info(`Document ${documentId} was deleted while being processed`);
      return;
    }
    // PdfParseErrors are about the PDF itself and carry a user-facing message.
    // Anything else is logged, though some still get a specific message: a
    // file removed outside the app, or an embedding service problem.
    if (error instanceof PdfParseError) {
      await recordFailure(documentId, error.message);
      return;
    }
    console.error(`Processing failed for document ${documentId}`, error);
    const errorMessage = isMissingFile(error)
      ? MISSING_FILE_MESSAGE
      : (describeEmbeddingError(error) ?? GENERIC_FAILURE_MESSAGE);
    await recordFailure(documentId, errorMessage);
  }
}

/** Marks a document as failed. Never throws: it runs where there's no one to report to. */
async function recordFailure(documentId: string, errorMessage: string): Promise<void> {
  await prisma.document
    .update({
      where: { id: documentId },
      data: { status: DocumentStatus.ERROR, errorMessage },
    })
    .catch((updateError: unknown) => {
      console.error(`Could not record failure for document ${documentId}`, updateError);
    });
}
