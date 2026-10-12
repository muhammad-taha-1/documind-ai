import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentChunkResult, SourceChunk } from "@/types";

const db = vi.hoisted(() => ({
  measureSearchableText: vi.fn<() => Promise<{ chunks: number; characters: number }>>(),
  listSearchableChunks: vi.fn<() => Promise<SourceChunk[]>>(),
  searchSimilarChunks: vi.fn<() => Promise<DocumentChunkResult[]>>(),
}));
vi.mock("@/lib/db/vectors", () => db);

const generateEmbedding = vi.hoisted(() => vi.fn<() => Promise<number[]>>());
vi.mock("./embeddings", () => ({ generateEmbedding }));

const { FULL_TEXT_MAX_CHARACTERS, retrieveContext, TOP_K } = await import("./rag");

const queryVector = [0.1, 0.2];

function result(id: string, similarity: number): DocumentChunkResult {
  return {
    id,
    content: `content of ${id}`,
    pageNumber: 1,
    chunkIndex: 0,
    documentId: "doc",
    documentTitle: "Doc",
    similarity,
  };
}

/** Documents too big to send whole, so retrieval has to search */
function largeDocuments() {
  db.measureSearchableText.mockResolvedValue({ chunks: 40, characters: FULL_TEXT_MAX_CHARACTERS + 1 });
}

beforeEach(() => {
  vi.resetAllMocks();
  generateEmbedding.mockResolvedValue(queryVector);
});

describe("retrieveContext", () => {
  it("searches large documents for the closest passages, scoped to the user", async () => {
    largeDocuments();
    db.searchSimilarChunks.mockResolvedValue([result("a", 0.62), result("b", 0.41)]);
    const signal = new AbortController().signal;

    const context = await retrieveContext("What is RDS?", ["doc"], "user-1", { signal });

    expect(context).toEqual({ mode: "MATCHED", sources: [result("a", 0.62), result("b", 0.41)] });
    expect(generateEmbedding).toHaveBeenCalledWith("What is RDS?", { signal });
    expect(db.measureSearchableText).toHaveBeenCalledWith(["doc"], "user-1");
    expect(db.searchSimilarChunks).toHaveBeenCalledWith(queryVector, ["doc"], "user-1", TOP_K);
  });

  it("drops passages below the similarity floor", async () => {
    largeDocuments();
    db.searchSimilarChunks.mockResolvedValue([result("a", 0.5), result("b", 0.2), result("c", 0.19)]);

    const { sources } = await retrieveContext("?", ["doc"], "user-1");

    expect(sources.map((source) => source.id)).toEqual(["a", "b"]);
  });

  it("flags a weak match when even the best passage scores low", async () => {
    largeDocuments();
    db.searchSimilarChunks.mockResolvedValue([result("a", 0.29), result("b", 0.21)]);

    const context = await retrieveContext("?", ["doc"], "user-1");

    expect(context.mode).toBe("WEAK_MATCH");
    expect(context.sources).toHaveLength(2);
  });

  it("reports no match when nothing clears the floor", async () => {
    largeDocuments();
    db.searchSimilarChunks.mockResolvedValue([result("a", 0.1)]);

    expect(await retrieveContext("hi", ["doc"], "user-1")).toEqual({ mode: "NO_MATCH", sources: [] });
  });

  it("sends small documents in full, without embedding the question", async () => {
    db.measureSearchableText.mockResolvedValue({ chunks: 5, characters: FULL_TEXT_MAX_CHARACTERS });
    const all: SourceChunk[] = [
      { ...result("first", 0), similarity: null },
      { ...result("second", 0), similarity: null },
    ];
    db.listSearchableChunks.mockResolvedValue(all);

    const context = await retrieveContext("Is this resume ok?", ["doc"], "user-1");

    expect(context).toEqual({ mode: "FULL_TEXT", sources: all });
    expect(db.listSearchableChunks).toHaveBeenCalledWith(["doc"], "user-1");
    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(db.searchSimilarChunks).not.toHaveBeenCalled();
  });

  it("skips the search entirely when the documents have no searchable text", async () => {
    db.measureSearchableText.mockResolvedValue({ chunks: 0, characters: 0 });

    expect(await retrieveContext("?", ["deleted-doc"], "user-1")).toEqual({
      mode: "NO_DOCUMENTS",
      sources: [],
    });
    expect(generateEmbedding).not.toHaveBeenCalled();
  });

  it("passes embedding failures to the caller", async () => {
    largeDocuments();
    generateEmbedding.mockRejectedValue(new Error("OpenAI is down"));

    await expect(retrieveContext("?", ["doc"], "user-1")).rejects.toThrow("OpenAI is down");
  });
});
