import { jsonError, withErrorHandling } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { deleteDocument } from "@/lib/documents/queries";

/**
 * DELETE /api/documents/:id — delete a document, its passages and its file.
 * Chats that included it stay, without it; their replies lose the sources
 * that came from it.
 */
export const DELETE = withErrorHandling(async (_request: Request, context: RouteContext<"/api/documents/[id]">) => {
  const session = await getSession();
  if (!session) {
    return jsonError(401, "You must be signed in.");
  }
  const { id } = await context.params;

  if (!(await deleteDocument(session.user.id, id))) {
    // Also returned for other users' documents, so IDs can't be probed
    return jsonError(404, "Document not found.");
  }
  return new Response(null, { status: 204 });
});
