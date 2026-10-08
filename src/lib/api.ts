/** Error body shape for every API route: `{ error: "human-readable message" }` */
export interface ApiError {
  error: string;
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message } satisfies ApiError, { status });
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
