import OpenAI from "openai";

export const EMBEDDING_MODEL = "text-embedding-3-small";
/** Must match the `vector(1536)` column in prisma/schema.prisma */
export const EMBEDDING_DIMENSIONS = 1536;

let client: OpenAI | undefined;

/**
 * Created on first use rather than at import: the constructor throws when
 * OPENAI_API_KEY is missing, which would break every module that imports
 * this one (builds, tests) even if it never embeds anything.
 */
function getClient(): OpenAI {
  // The SDK retries timeouts, connection errors, 429s and 5xxs with
  // exponential backoff; one more attempt than the default rides out brief
  // rate limiting.
  client ??= new OpenAI({ maxRetries: 3 });
  return client;
}

export interface EmbeddingOptions {
  /** Cancels the request, e.g. when the user who asked for it has gone */
  signal?: AbortSignal;
}

/**
 * Embeds several texts in one request. The API accepts up to 2,048 inputs
 * (and 300k tokens) per request; callers batch well below that.
 */
export async function generateEmbeddings(texts: string[], { signal }: EmbeddingOptions = {}): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  const response = await getClient().embeddings.create({ model: EMBEDDING_MODEL, input: texts }, { signal });

  // Each result carries the index of its input, so match on that rather than
  // relying on the response order
  const embeddings = response.data.toSorted((a, b) => a.index - b.index).map((d) => d.embedding);
  if (embeddings.length !== texts.length) {
    throw new Error(`Expected ${texts.length} embeddings, got ${embeddings.length}`);
  }
  for (const embedding of embeddings) {
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Expected ${EMBEDDING_DIMENSIONS}-dimension embeddings, got ${embedding.length}`);
    }
  }
  return embeddings;
}

/**
 * What to tell the user when embedding failed for a reason they (or the
 * site owner) can act on, or null for anything unexpected. The SDK has
 * already retried the transient ones by the time they reach here.
 */
export function describeEmbeddingError(error: unknown): string | null {
  // Most specific first: these are all APIError subclasses
  if (error instanceof OpenAI.RateLimitError) {
    // A 429 is either a used-up quota (retrying won't help) or plain busyness
    return error.code === "insufficient_quota"
      ? "The embedding service's usage quota has run out. Please contact the site owner."
      : "The embedding service is busy right now. Please retry in a minute.";
  }
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
    return "The embedding service isn't configured correctly. Please contact the site owner.";
  }
  if (error instanceof OpenAI.InternalServerError) {
    return "The embedding service is having problems right now. Please retry shortly.";
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return "Couldn't reach the embedding service. Please retry.";
  }
  return null;
}

export async function generateEmbedding(text: string, options?: EmbeddingOptions): Promise<number[]> {
  const [embedding] = await generateEmbeddings([text], options);
  return embedding;
}
