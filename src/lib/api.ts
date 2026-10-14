/** Error body shape for every API route: `{ error: "human-readable message" }` */
export interface ApiError {
  error: string;
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message } satisfies ApiError, { status });
}

const DEFAULT_MAX_JSON_BYTES = 16 * 1024;

/**
 * Reads a small JSON request body. Route handlers have no body size limit
 * and request.json() buffers everything, so the declared size is checked
 * before reading. On failure, returns the error response to send instead.
 */
export async function readJsonBody(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const contentLength = Number(request.headers.get("content-length"));
  if (!Number.isInteger(contentLength) || contentLength <= 0) {
    return { ok: false, response: jsonError(411, "Content-Length header is required.") };
  }
  if (contentLength > maxBytes) {
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

/**
 * Content-Disposition header for a file shown in the browser. The plain
 * `filename` is an ASCII fallback; `filename*` carries the real name (RFC 6266).
 */
export function inlineContentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  // encodeURIComponent leaves these alone, but RFC 8187 values must not contain them
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
