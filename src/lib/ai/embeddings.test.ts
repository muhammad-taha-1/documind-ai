import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeVector } from "@/test/embeddings";

interface FakeEmbedding {
  embedding: number[];
  index: number;
}

const { create, constructed } = vi.hoisted(() => ({
  create: vi.fn<(body: { model: string; input: string[] }) => Promise<{ data: FakeEmbedding[] }>>(),
  constructed: [] as unknown[],
}));

vi.mock("openai", () => ({
  default: class {
    embeddings = { create };
    constructor(options: unknown) {
      constructed.push(options);
    }
  },
}));

const { EMBEDDING_MODEL, generateEmbedding, generateEmbeddings } = await import("./embeddings");
const clientsAtImport = constructed.length;

/** Answers like the API: one embedding per input, in the order given. */
function respondWith(vectors: number[][], order = vectors.map((_, i) => i)) {
  create.mockResolvedValueOnce({
    data: order.map((index) => ({ embedding: vectors[index], index })),
  });
}

beforeEach(() => {
  create.mockReset();
});

describe("generateEmbeddings", () => {
  it("embeds all texts in one request with the configured model", async () => {
    const vectors = [makeVector({ 0: 1 }), makeVector({ 1: 1 })];
    respondWith(vectors);

    expect(await generateEmbeddings(["first", "second"])).toEqual(vectors);
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({ model: EMBEDDING_MODEL, input: ["first", "second"] });
  });

  it("matches results to inputs by index, not response order", async () => {
    const vectors = [makeVector({ 0: 1 }), makeVector({ 1: 1 }), makeVector({ 2: 1 })];
    respondWith(vectors, [2, 0, 1]);

    expect(await generateEmbeddings(["a", "b", "c"])).toEqual(vectors);
  });

  it("makes no request for an empty list", async () => {
    expect(await generateEmbeddings([])).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a response with the wrong number of embeddings", async () => {
    respondWith([makeVector({ 0: 1 })]);
    await expect(generateEmbeddings(["a", "b"])).rejects.toThrow("Expected 2 embeddings, got 1");
  });

  it("rejects embeddings with the wrong dimensions", async () => {
    respondWith([[0.1, 0.2, 0.3]]);
    await expect(generateEmbeddings(["a"])).rejects.toThrow(/1536-dimension/);
  });

  it("passes API errors through", async () => {
    create.mockRejectedValueOnce(new Error("rate limited"));
    await expect(generateEmbeddings(["a"])).rejects.toThrow("rate limited");
  });

  it("creates the client on first use, once, with extra retries", () => {
    // Importing must not construct it (that throws without an API key)...
    expect(clientsAtImport).toBe(0);
    // ...and after several calls above, there's still only one
    expect(constructed).toEqual([{ maxRetries: 3 }]);
  });
});

describe("generateEmbedding", () => {
  it("embeds a single text", async () => {
    const vector = makeVector({ 5: 1 });
    respondWith([vector]);

    expect(await generateEmbedding("question")).toEqual(vector);
    expect(create).toHaveBeenCalledWith({ model: EMBEDDING_MODEL, input: ["question"] });
  });
});
