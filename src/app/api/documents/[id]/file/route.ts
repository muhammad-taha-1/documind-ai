import { readFile } from "node:fs/promises";
import { inlineContentDisposition, jsonError } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { getDocumentFile } from "@/lib/documents/queries";
import { resolveStorageKey } from "@/lib/storage";

/**
 * GET /api/documents/:id/file — the uploaded PDF, shown in the browser's viewer.
 * Links can add `#page=N` to open it at a page.
 */
export async function GET(_request: Request, context: RouteContext<"/api/documents/[id]/file">) {
  const session = await getSession();
  if (!session) {
    return jsonError(401, "You must be signed in.");
  }
  const { id } = await context.params;

  const document = await getDocumentFile(session.user.id, id);
  if (!document) {
    // Also returned for other users' documents, so IDs can't be probed
    return jsonError(404, "Document not found.");
  }

  let bytes: Buffer;
  try {
    // Uploads are at most 10 MB, so reading the whole file is fine
    bytes = await readFile(resolveStorageKey(document.filePath));
  } catch (error) {
    console.error(`Could not read the file of document ${id}`, error);
    return jsonError(404, "The file for this document is missing.");
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": document.mimeType,
      "content-length": String(bytes.byteLength),
      "content-disposition": inlineContentDisposition(document.fileName),
      // Uploads were checked to be PDFs; never let the browser guess otherwise
      "x-content-type-options": "nosniff",
      // Private to the signed-in user, and gone once the document is deleted
      "cache-control": "private, no-cache",
    },
  });
}
