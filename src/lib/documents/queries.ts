import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { DocumentDetail, DocumentPassage, DocumentSummary, SourceChunk } from "@/types";
import { deleteFile } from "@/lib/storage";

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

/** Where one of the user's documents is stored, or null if they have no such document. */
export async function getDocumentFile(
  userId: string,
  documentId: string,
): Promise<{ filePath: string; fileName: string; mimeType: string } | null> {
  return prisma.document.findFirst({
    where: { id: documentId, userId },
    select: { filePath: true, fileName: true, mimeType: true },
  });
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

/** One of the user's documents, for its page, or null if they have no such document. */
export async function getDocumentDetail(userId: string, documentId: string): Promise<DocumentDetail | null> {
  const document = await getDocumentSummary(userId, documentId);
  if (!document) {
    return null;
  }
  const chatCount = await prisma.conversation.count({
    where: { userId, documentIds: { has: documentId } },
  });
  return { ...document, chatCount };
}

export const PASSAGES_PER_PAGE = 20;

export interface PassagePage {
  /** In reading order */
  passages: DocumentPassage[];
  /** How many passages match, across all pages */
  total: number;
  /** 1-based; always between 1 and pageCount */
  page: number;
  /** At least 1, even when nothing matches */
  pageCount: number;
}

/**
 * One page of a document's passages, optionally only those containing
 * `query` (ignoring case). With `chunkId` (and no query), returns the page
 * that passage is on — how a citation's "open document" link finds it.
 */
export async function listDocumentPassages(
  userId: string,
  documentId: string,
  { page = 1, query, chunkId }: { page?: number; query?: string; chunkId?: string } = {},
): Promise<PassagePage> {
  const where = {
    documentId,
    document: { userId },
    // Prisma passes `contains` to ILIKE as is, so escape its wildcards (backslash is Postgres's default escape)
    ...(query && { content: { contains: query.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" } }),
  } satisfies Prisma.DocumentChunkWhereInput;

  if (chunkId && !query) {
    const target = await prisma.documentChunk.findFirst({
      where: { ...where, id: chunkId },
      select: { chunkIndex: true },
    });
    if (target) {
      const before = await prisma.documentChunk.count({
        where: { ...where, chunkIndex: { lt: target.chunkIndex } },
      });
      page = Math.floor(before / PASSAGES_PER_PAGE) + 1;
    }
  }

  const total = await prisma.documentChunk.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PASSAGES_PER_PAGE));
  // Out-of-range pages (an old link, a hand-edited URL) show the nearest real one
  const current = Math.min(Math.max(1, Math.floor(page)), pageCount);
  const passages = await prisma.documentChunk.findMany({
    where,
    orderBy: { chunkIndex: "asc" },
    skip: (current - 1) * PASSAGES_PER_PAGE,
    take: PASSAGES_PER_PAGE,
    select: { id: true, content: true, pageNumber: true, chunkIndex: true },
  });
  return { passages, total, page: current, pageCount };
}

/**
 * Deletes one of the user's documents: its passages (and with them the
 * sources that cite them), its place in the user's chats, and its file.
 * False if the user has no such document.
 */
export async function deleteDocument(userId: string, documentId: string): Promise<boolean> {
  const filePath = await prisma.$transaction(async (tx) => {
    const document = await tx.document.findFirst({
      where: { id: documentId, userId },
      select: { filePath: true },
    });
    if (!document) {
      return null;
    }
    // deleteMany so the userId filter applies; if a concurrent request got
    // there first, this one deletes nothing and reports not found.
    // Chunks and their MessageSources go with it (onDelete: Cascade).
    const { count } = await tx.document.deleteMany({ where: { id: documentId, userId } });
    if (count === 0) {
      return null;
    }
    // documentIds is a plain array with no foreign key, so remove the ID by
    // hand. Leaves updatedAt alone: losing a document isn't chat activity.
    await tx.$executeRaw`
      UPDATE "Conversation"
      SET "documentIds" = array_remove("documentIds", ${documentId})
      WHERE "userId" = ${userId} AND ${documentId} = ANY("documentIds")`;
    return document.filePath;
  });
  if (filePath === null) {
    return false;
  }

  // After the commit: if this fails, the leftover file is unreachable but
  // harmless, whereas deleting it first could leave a row with no file
  await deleteFile(filePath).catch((error: unknown) => {
    console.error(`Could not delete the file of deleted document ${documentId}`, filePath, error);
  });
  return true;
}
