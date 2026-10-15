/** Error body shape for every API route: `{ error: "human-readable message" }` */
export interface ApiError {
  error: string;
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message } satisfies ApiError, { status });
}

const DEFAULT_MAX_JSON_BYTES = 16 * 1024;

export type ReadBodyResult = { ok: true; body: unknown } | { ok: false; response: Response };

/**
 * The error response for a request body that's too big or of unknown size,
 * or null if it's fine to read. Route handlers have no body size limit, and
 * request.json() and request.formData() buffer everything, so the declared
 * size is checked first. Requiring it rules out unbounded chunked bodies.
 */
export function checkContentLength(request: Request, maxBytes: number): Response | null {
  const contentLength = Number(request.headers.get("content-length"));
  if (!Number.isInteger(contentLength) || contentLength <= 0) {
    return jsonError(411, "Content-Length header is required.");
  }
  if (contentLength > maxBytes) {
    return jsonError(413, "Request body is too large.");
  }
  return null;
}

/** Reads a small JSON request body. On failure, returns the error response to send instead. */
export async function readJsonBody(request: Request, maxBytes = DEFAULT_MAX_JSON_BYTES): Promise<ReadBodyResult> {
  const lengthError = checkContentLength(request, maxBytes);
  if (lengthError) {
    return { ok: false, response: lengthError };
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
