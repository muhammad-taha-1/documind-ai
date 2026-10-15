import { inlineContentDisposition, jsonError } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { getAttachmentFile } from "@/lib/chat/queries";
import { readStoredFile } from "@/lib/storage";

/**
 * GET /api/attachments/:id — an image attached to a chat message, for the
 * signed-in user who sent it.
 */
export async function GET(request: Request, context: RouteContext<"/api/attachments/[id]">) {
  const session = await getSession();
  if (!session) {
    return jsonError(401, "You must be signed in.");
  }
  const { id } = await context.params;

  const attachment = await getAttachmentFile(session.user.id, id);
  if (!attachment) {
    // Also returned for other users' images, so IDs can't be probed
    return jsonError(404, "Image not found.");
  }

  // An attachment's file never changes (a new upload gets a new ID), so the
  // ID is all the ETag needs. The browser still asks every time (no-cache),
  // because the image must stop loading once its chat is deleted.
  const etag = `"${id}"`;
  const headers = {
    etag,
    "cache-control": "private, no-cache",
  };
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  let bytes: Buffer;
  try {
    // Stored images are re-encoded to at most a few MB, so reading them whole is fine
    bytes = await readStoredFile(attachment.storageKey);
  } catch (error) {
    console.error(`Could not read attachment ${id}`, error);
    return jsonError(404, "The file for this image is missing.");
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      ...headers,
      // The stored file's real format: it was decoded and re-encoded on upload
      "content-type": attachment.mediaType,
      "content-length": String(bytes.byteLength),
      "content-disposition": inlineContentDisposition(attachment.fileName),
      "x-content-type-options": "nosniff",
    },
  });
}
