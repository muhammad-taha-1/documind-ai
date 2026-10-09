import { jsonError } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { deleteConversation, getConversation } from "@/lib/chat/queries";

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
