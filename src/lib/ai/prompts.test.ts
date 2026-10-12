import { describe, expect, it } from "vitest";
import type { SourceChunk } from "@/types";
import { buildRAGPrompt } from "./prompts";

function chunk(overrides: Partial<SourceChunk>): SourceChunk {
  return {
    id: "chunk",
    content: "Text",
    pageNumber: 1,
    chunkIndex: 0,
    documentId: "doc",
    documentTitle: "Doc",
    similarity: 0.5,
    ...overrides,
  };
}

describe("buildRAGPrompt", () => {
  it("numbers the passages in order and puts the question after them", () => {
    const prompt = buildRAGPrompt("What is RDS?", {
      mode: "MATCHED",
      sources: [
        chunk({ content: "RDS is a managed database.", documentTitle: "AWS Q&A", pageNumber: 2 }),
        chunk({ content: "Aurora is compatible with MySQL.", documentTitle: "AWS Q&A", pageNumber: 7 }),
      ],
    });

    expect(prompt).toBe(
      [
        "<context>",
        "[Source 1 — AWS Q&A, page 2]",
        "RDS is a managed database.",
        "",
        "---",
        "",
        "[Source 2 — AWS Q&A, page 7]",
        "Aurora is compatible with MySQL.",
        "</context>",
        "",
        "<question>",
        "What is RDS?",
        "</question>",
      ].join("\n"),
    );
  });

  it("leaves the page out when it isn't known", () => {
    const prompt = buildRAGPrompt("?", { mode: "MATCHED", sources: [chunk({ pageNumber: null })] });
    expect(prompt).toContain("[Source 1 — Doc]\n");
  });

  it("says when the passages are the full text", () => {
    const prompt = buildRAGPrompt("Is this resume ok?", { mode: "FULL_TEXT", sources: [chunk({})] });
    expect(prompt).toMatch(/^<context>\nThe full text of the user's documents, in reading order:\n\n\[Source 1/);
  });

  it("warns Claude when the passages only loosely match", () => {
    const prompt = buildRAGPrompt("?", { mode: "WEAK_MATCH", sources: [chunk({})] });
    expect(prompt).toMatch(/^<context>\n.*only loosely match the question.*\n\n\[Source 1/);
  });

  it.each([
    ["NO_MATCH", "No passage in the user's documents closely matches this question."],
    ["NO_DOCUMENTS", "The documents in this chat have no searchable text right now"],
  ] as const)("explains an empty context (%s)", (mode, note) => {
    const prompt = buildRAGPrompt("Hi", { mode, sources: [] });
    expect(prompt).toContain(`<context>\n${note}`);
    expect(prompt).toContain("<question>\nHi\n</question>");
    expect(prompt).not.toContain("[Source");
  });
});
