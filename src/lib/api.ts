/** Error body shape for every API route: `{ error: "human-readable message" }` */
export interface ApiError {
  error: string;
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message } satisfies ApiError, { status });
}

const MAX_JSON_BODY_BYTES = 16 * 1024;

/**
 * Reads a small JSON request body. Route handlers have no body size limit
 * and request.json() buffers everything, so the declared size is checked
 * before reading. On failure, returns the error response to send instead.
 */
export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const contentLength = Number(request.headers.get("content-length"));
  if (!Number.isInteger(contentLength) || contentLength <= 0) {
    return { ok: false, response: jsonError(411, "Content-Length header is required.") };
  }
  if (contentLength > MAX_JSON_BODY_BYTES) {
    return { ok: false, response: jsonError(413, "Request body is too large.") };
  }
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: jsonError(400, "Request body must be valid JSON.") };
  }
}

/** Client side: the `error` message from an API response body, or the fallback. */
export function parseApiError(responseText: string, fallback: string): string {
  try {
    const body = JSON.parse(responseText) as Partial<ApiError>;
    return typeof body.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}
