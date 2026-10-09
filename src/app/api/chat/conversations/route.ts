import { jsonError, readJsonBody } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { createConversation, listConversations } from "@/lib/chat/queries";
import { createConversationSchema, firstIssueMessage } from "@/lib/chat/validation";

/** GET /api/chat/conversations — the signed-in user's conversations, most recent first */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return jsonError(401, "You must be signed in.");
  }
  return Response.json({ conversations: await listConversations(session.user.id) });
}

/** POST /api/chat/conversations — start a conversation. Body: `{ documentIds: string[] }` */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return jsonError(401, "You must be signed in.");
  }

  const json = await readJsonBody(request);
  if (!json.ok) {
    return json.response;
  }
  const parsed = createConversationSchema.safeParse(json.body);
  if (!parsed.success) {
    return jsonError(400, firstIssueMessage(parsed.error));
  }

  const result = await createConversation(session.user.id, parsed.data.documentIds);
  if (result.status === "documents_not_found") {
    // Same answer for other users' documents and IDs that don't exist, so
    // IDs can't be probed
    return jsonError(403, "One or more documents were not found.");
  }
  return Response.json({ conversation: result.conversation }, { status: 201 });
}
