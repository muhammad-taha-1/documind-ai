import { describe, expect, it } from "vitest";
import { documentFilePath, documentPath, passagePath } from "./paths";

describe("document paths", () => {
  it("links to the document's page", () => {
    expect(documentPath("doc-1")).toBe("/documents/doc-1");
  });

  it("links to a passage on the document's page", () => {
    expect(passagePath("doc-1", "chunk-9")).toBe("/documents/doc-1?chunk=chunk-9#passage-chunk-9");
  });

  it("links to the PDF, optionally at a page", () => {
    expect(documentFilePath("doc-1")).toBe("/api/documents/doc-1/file");
    expect(documentFilePath("doc-1", null)).toBe("/api/documents/doc-1/file");
    expect(documentFilePath("doc-1", 3)).toBe("/api/documents/doc-1/file#page=3");
  });

  it("encodes IDs", () => {
    expect(documentPath("a/b?c")).toBe("/documents/a%2Fb%3Fc");
  });
});
