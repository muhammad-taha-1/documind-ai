/** Error body shape for every API route: `{ error: "human-readable message" }` */
export interface ApiError {
  error: string;
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message } satisfies ApiError, { status });
}
