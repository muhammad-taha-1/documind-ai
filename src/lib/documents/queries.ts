import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { DocumentSummary, SourceChunk } from "@/types";

// Explicit select so internal columns (filePath, userId) never reach a response
export const documentSummarySelect = {
  id: true,
  title: true,
  fileName: true,
  fileSize: true,
  pageCount: true,
  status: true,
  errorMessage: true,
  totalChunks: true,
  embeddedChunks: true,
  createdAt: true,
} satisfies Prisma.DocumentSelect;

type DocumentSummaryRow = Prisma.DocumentGetPayload<{ select: typeof documentSummarySelect }>;

export function toDocumentSummary(row: DocumentSummaryRow): DocumentSummary {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/** The user's documents, newest first. */
export async function listDocuments(userId: string): Promise<DocumentSummary[]> {
  const rows = await prisma.document.findMany({
    where: { userId },
    select: documentSummarySelect,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toDocumentSummary);
}

/** One of the user's documents, or null if they have no such document. */
export async function getDocumentSummary(
  userId: string,
  documentId: string,
): Promise<DocumentSummary | null> {
  const row = await prisma.document.findFirst({
    where: { id: documentId, userId },
    select: documentSummarySelect,
  });
  return row && toDocumentSummary(row);
}

const pageChunkSelect = {
  id: true,
  content: true,
  pageNumber: true,
  chunkIndex: true,
  documentId: true,
  document: { select: { title: true } },
} satisfies Prisma.DocumentChunkSelect;

/**
 * The passages covering one page of the user's document, in reading order.
 * A chunk records the page it starts on, so the top of a page can sit at the
 * end of a chunk that started earlier: the last such chunk is included too.
 * Similarity is null because nothing was searched.
 */
export async function getPageChunks(
  userId: string,
  documentId: string,
  pageNumber: number,
): Promise<SourceChunk[]> {
  const where = { documentId, document: { userId } };
  const before = await prisma.documentChunk.findFirst({
    where: { ...where, pageNumber: { lt: pageNumber } },
    orderBy: { chunkIndex: "desc" },
    select: pageChunkSelect,
  });
  const onPage = await prisma.documentChunk.findMany({
    where: { ...where, pageNumber },
    orderBy: { chunkIndex: "asc" },
    select: pageChunkSelect,
  });
  return [...(before ? [before] : []), ...onPage].map(({ document, ...chunk }) => ({
    ...chunk,
    documentTitle: document.title,
    similarity: null,
  }));
}
