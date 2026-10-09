import { describe, expect, it, vi } from "vitest";
import { makeVector } from "@/test/embeddings";
import { toVectorLiteral } from "./vectors";

// The real client needs DATABASE_URL; nothing here touches the database
vi.mock("./prisma", () => ({ prisma: {} }));

describe("toVectorLiteral", () => {
  it("formats a vector as pgvector text", () => {
    const literal = toVectorLiteral(makeVector({ 0: 0.5, 2: -1.25 }));
    expect(literal.startsWith("[0.5,0,-1.25,0,")).toBe(true);
    expect(literal.endsWith(",0]")).toBe(true);
    expect(literal.split(",")).toHaveLength(1536);
  });

  it("rejects vectors with the wrong dimensions", () => {
    expect(() => toVectorLiteral([1, 2, 3])).toThrow(RangeError);
  });

  it.each([NaN, Infinity, -Infinity])("rejects %s values", (value) => {
    expect(() => toVectorLiteral(makeVector({ 7: value }))).toThrow(RangeError);
  });
});
