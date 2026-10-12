import { describe, expect, it } from "vitest";
import type { SourceChunk } from "@/types";
import { SourceList } from "./sources";

const chunk = (id: string, similarity: number | null = null): SourceChunk => ({
  id,
  content: id,
  pageNumber: 1,
  chunkIndex: 0,
  documentId: "doc",
  documentTitle: "Doc",
  similarity,
});

describe("SourceList", () => {
  it("numbers passages from 1 in the order they arrive", () => {
    const sources = new SourceList([chunk("a"), chunk("b")]);

    expect(sources.add(chunk("c"))).toEqual({ number: 3, isNew: true });
    expect(sources.all.map((source) => source.id)).toEqual(["a", "b", "c"]);
  });

  it("gives a passage that comes back again its original number", () => {
    const sources = new SourceList([chunk("a", 0.7)]);

    expect(sources.add(chunk("a", 0.3))).toEqual({ number: 1, isNew: false });
    expect(sources.all).toEqual([chunk("a", 0.7)]);
  });

  it("starts empty", () => {
    expect(new SourceList().all).toEqual([]);
  });
});
