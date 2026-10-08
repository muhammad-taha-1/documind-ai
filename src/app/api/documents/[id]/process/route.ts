import { after } from "next/server";
import { jsonError } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { claimDocumentForProcessing, runProcessing } from "@/lib/documents/processing";

/**
 * POST /api/documents/:id/process — (re)start processing a document.
 *
 * Uploads start processing automatically; this endpoint is for retrying a
 * document that ended in ERROR. Returns 202 Accepted straight away — the work
 * runs after the response, and the dashboard polls for the result.
 */
export async function POST(_request: Request, context: RouteContext<"/api/documents/[id]/process">) {
  const session = await getSession();
  if (!session) {
    return jsonError(401, "You must be signed in.");
  }
  const { id } = await context.params;

  const claim = await claimDocumentForProcessing(id, session.user.id);
  if (claim === "not_found") {
    // Also returned for other users' documents, so IDs can't be probed
    return jsonError(404, "Document not found.");
  }
  if (claim === "busy") {
    return jsonError(409, "This document is already being processed.");
  }

  after(() => runProcessing(id));
  return Response.json({ status: "PROCESSING" }, { status: 202 });
}
