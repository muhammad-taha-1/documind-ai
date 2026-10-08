import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { jsonError } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { claimDocumentForProcessing, runProcessing } from "@/lib/documents/processing";
import { documentSummarySelect, listDocuments, toDocumentSummary } from "@/lib/documents/queries";
import { deleteFile, documentStorageKey, saveFile } from "@/lib/documents/storage";
import {
  hasPdfSignature,
  MAX_FILE_SIZE,
  PDF_MIME_TYPE,
  sanitizeFileName,
  titleFromFileName,
} from "@/lib/documents/validation";
import type { DocumentSummary } from "@/types";

// Room for the multipart boundaries and headers around the file itself
const MULTIPART_OVERHEAD = 64 * 1024;

/** GET /api/documents — the signed-in user's documents, newest first */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return jsonError(401, "You must be signed in.");
  }
  return Response.json({ documents: await listDocuments(session.user.id) });
}

/** POST /api/documents — upload a PDF (multipart/form-data, field "file") */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return jsonError(401, "You must be signed in.");
  }
  const userId = session.user.id;

  // Route handlers have no body size limit, and request.formData() buffers the
  // whole body in memory — so reject oversized requests from the header before
  // reading anything. Requiring Content-Length rules out unbounded chunked bodies.
  const contentLength = Number(request.headers.get("content-length"));
  if (!Number.isInteger(contentLength) || contentLength <= 0) {
    return jsonError(411, "Content-Length header is required.");
  }
  if (contentLength > MAX_FILE_SIZE + MULTIPART_OVERHEAD) {
    return jsonError(413, "File is too large. The maximum size is 10 MB.");
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError(400, "Expected a multipart/form-data upload.");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return jsonError(400, "No file was uploaded.");
  }
  if (file.size === 0) {
    return jsonError(400, "This file is empty.");
  }
  if (file.size > MAX_FILE_SIZE) {
    return jsonError(413, "File is too large. The maximum size is 10 MB.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasPdfSignature(bytes)) {
    return jsonError(415, "Only PDF files are supported.");
  }

  // Generate the ID up front so the file can be written to its final location
  // before the DB row exists. If the insert fails, we delete the file, so
  // there's never a row pointing at a missing file.
  const documentId = randomUUID();
  const filePath = documentStorageKey(userId, documentId);
  const fileName = sanitizeFileName(file.name);

  try {
    await saveFile(filePath, bytes);
  } catch (error) {
    console.error("Failed to save upload", error);
    return jsonError(500, "Could not save the file. Please try again.");
  }

  let document: DocumentSummary;
  try {
    const row = await prisma.document.create({
      data: {
        id: documentId,
        title: titleFromFileName(fileName),
        fileName,
        fileSize: file.size,
        mimeType: PDF_MIME_TYPE,
        filePath,
        userId,
      },
      select: documentSummarySelect,
    });
    document = toDocumentSummary(row);
  } catch (error) {
    console.error("Failed to create document record", error);
    await deleteFile(filePath).catch((cleanupError: unknown) => {
      console.error("Failed to remove orphaned upload", filePath, cleanupError);
    });
    return jsonError(500, "Could not save the document. Please try again.");
  }

  // Start processing once the response has been sent. Doing it server-side
  // (rather than having the browser call /process) means processing still
  // happens if the user closes the tab right after uploading.
  after(async () => {
    try {
      if ((await claimDocumentForProcessing(documentId, userId)) === "claimed") {
        await runProcessing(documentId);
      }
    } catch (error) {
      // The document stays UPLOADING; POST /api/documents/:id/process restarts it
      console.error(`Could not start processing document ${documentId}`, error);
    }
  });

  return Response.json({ document }, { status: 201 });
}
