import { generateEmbeddings } from "@/lib/ai/embeddings";
import { prisma } from "@/lib/db/prisma";
import { toVectorLiteral } from "@/lib/db/vectors";

/**
 * Chunks per embeddings request. The API allows far more, but small batches
 * keep each request quick, make a failure cheap to repeat, and move the
 * progress counter ("Embedding 20/45") in visible steps.
 */
export const EMBEDDING_BATCH_SIZE = 20;

/**
 * Embeds all of a document's chunks, batch by batch, adding to
 * `embeddedChunks` as each batch is stored. Throws if any batch fails (the
 * OpenAI client has already retried transient errors by then).
 */
export async function embedDocumentChunks(documentId: string): Promise<void> {
  const chunks = await prisma.documentChunk.findMany({
    where: { documentId },
    orderBy: { chunkIndex: "asc" },
    select: { id: true, content: true },
  });

  for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(start, start + EMBEDDING_BATCH_SIZE);
    const embeddings = await generateEmbeddings(batch.map((chunk) => chunk.content));

    const ids = batch.map((chunk) => chunk.id);
    const vectors = embeddings.map(toVectorLiteral);

    // Storing the batch and counting it happen together, so the progress
    // counter always matches the number of embeddings actually saved
    await prisma.$transaction(async (tx) => {
      // One UPDATE for the whole batch: unnest pairs each id with its vector
      const stored = await tx.$executeRaw`
        UPDATE "DocumentChunk" AS dc
        SET embedding = batch.embedding::vector
        FROM unnest(${ids}::text[], ${vectors}::text[]) AS batch(id, embedding)
        WHERE dc.id = batch.id AND dc."documentId" = ${documentId}
      `;
      if (stored !== batch.length) {
        // A chunk vanished mid-run — e.g. the document was deleted
        throw new Error(`Stored ${stored} of ${batch.length} embeddings for document ${documentId}`);
      }
      await tx.document.update({
        where: { id: documentId },
        data: { embeddedChunks: { increment: stored } },
      });
    });
  }
}
