import { jsonError, readJsonBody } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { deleteConversation, getConversation, updateConversation } from "@/lib/chat/queries";
import { firstIssueMessage, updateConversationSchema } from "@/lib/chat/validation";

type Context = RouteContext<"/api/chat/conversations/[id]">;

/** GET /api/chat/conversations/:id — a conversation with its documents and messages */
export async function GET(_request: Request, context: Context) {
  const session = await getSession();
  if (!session) {
    return jsonError(401, "You must be signed in.");
  }
  const { id } = await context.params;

  const conversation = await getConversation(session.user.id, id);
  if (!conversation) {
    // Also returned for other users' conversations, so IDs can't be probed
    return jsonError(404, "Conversation not found.");
  }
  return Response.json({ conversation });
}

/**
 * PATCH /api/chat/conversations/:id — rename a conversation and/or change its documents.
 * Body: `{ title?: string, documentIds?: string[] }` (at least one).
 * Responds with the conversation and its documents as they now are.
 */
export async function PATCH(request: Request, context: Context) {
  const session = await getSession();
  if (!session) {
    return jsonError(401, "You must be signed in.");
  }
  const { id } = await context.params;

  const json = await readJsonBody(request);
  if (!json.ok) {
    return json.response;
  }
  const parsed = updateConversationSchema.safeParse(json.body);
  if (!parsed.success) {
    return jsonError(400, firstIssueMessage(parsed.error));
  }

  const result = await updateConversation(session.user.id, id, parsed.data);
  switch (result.status) {
    case "not_found":
      return jsonError(404, "Conversation not found.");
    case "documents_not_found":
      // Same answer for other users' documents and IDs that don't exist
      return jsonError(403, "One or more documents were not found.");
    case "updated":
      return Response.json({ conversation: result.conversation, documents: result.documents });
  }
}

/** DELETE /api/chat/conversations/:id — delete a conversation and its messages */
export async function DELETE(_request: Request, context: Context) {
  const session = await getSession();
  if (!session) {
    return jsonError(401, "You must be signed in.");
  }
  const { id } = await context.params;

  if (!(await deleteConversation(session.user.id, id))) {
    return jsonError(404, "Conversation not found.");
  }
  return new Response(null, { status: 204 });
}
