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

/**
 * Embeds several texts in one request. The API accepts up to 2,048 inputs
 * (and 300k tokens) per request; callers batch well below that.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  const response = await getClient().embeddings.create({ model: EMBEDDING_MODEL, input: texts });

  // Each result carries the index of its input, so match on that rather than
  // relying on the response order
  const embeddings = response.data.toSorted((a, b) => a.index - b.index).map((d) => d.embedding);
  if (embeddings.length !== texts.length) {
    throw new Error(`Expected ${texts.length} embeddings, got ${embeddings.length}`);
  }
  for (const embedding of embeddings) {
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Expected ${EMBEDDING_DIMENSIONS}-dimension embeddings, got ${embedding.length}`,
      );
    }
  }
  return embeddings;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const [embedding] = await generateEmbeddings([text]);
  return embedding;
}
