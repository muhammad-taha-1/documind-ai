import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { DocumentSummary } from "@/types";

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
