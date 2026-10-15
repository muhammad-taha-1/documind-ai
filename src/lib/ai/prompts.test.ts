import { describe, expect, it } from "vitest";
import type { ChatDocument } from "@/lib/chat/queries";
import type { SourceChunk } from "@/types";
import { buildRAGPrompt, imageOnlyQuestion } from "./prompts";

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

const awsGuide: ChatDocument = { id: "doc-aws", title: "AWS Q&A", pageCount: 10 };

describe("buildRAGPrompt", () => {
  it("lists the documents, numbers the passages in order, then asks the question", () => {
    const prompt = buildRAGPrompt(
      "What is RDS?",
      {
        mode: "MATCHED",
        sources: [
          chunk({ content: "RDS is a managed database.", documentTitle: "AWS Q&A", pageNumber: 2 }),
          chunk({ content: "Aurora is compatible with MySQL.", documentTitle: "AWS Q&A", pageNumber: 7 }),
        ],
      },
      [awsGuide],
    );

    expect(prompt).toBe(
      [
        "<documents>",
        "The documents in this chat (use these IDs with your tools):",
        "- AWS Q&A (id: doc-aws, 10 pages)",
        "</documents>",
        "",
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

  it("describes every document, including ones without a page count", () => {
    const prompt = buildRAGPrompt("?", { mode: "NO_MATCH", sources: [] }, [
      awsGuide,
      { id: "doc-1", title: "One-pager", pageCount: 1 },
      { id: "doc-2", title: "Scan", pageCount: null },
    ]);
    expect(prompt).toContain(
      "- AWS Q&A (id: doc-aws, 10 pages)\n- One-pager (id: doc-1, 1 page)\n- Scan (id: doc-2, page count unknown)",
    );
  });

  it("says when the chat has no documents", () => {
    const prompt = buildRAGPrompt("?", { mode: "NO_DOCUMENTS", sources: [] }, []);
    expect(prompt).toMatch(/^<documents>\nThis chat has no documents.\n<\/documents>/);
  });

  it("leaves the page out when it isn't known", () => {
    const prompt = buildRAGPrompt("?", { mode: "MATCHED", sources: [chunk({ pageNumber: null })] }, [awsGuide]);
    expect(prompt).toContain("[Source 1 — Doc]\n");
  });

  it("says when the passages are the full text", () => {
    const prompt = buildRAGPrompt("Is this resume ok?", { mode: "FULL_TEXT", sources: [chunk({})] }, [awsGuide]);
    expect(prompt).toMatch(/<context>\nThe full text of the user's documents, in reading order:\n\n\[Source 1/);
  });

  it("warns Claude when the passages only loosely match", () => {
    const prompt = buildRAGPrompt("?", { mode: "WEAK_MATCH", sources: [chunk({})] }, [awsGuide]);
    expect(prompt).toMatch(/<context>\n.*only loosely match the question.*\n\n\[Source 1/);
  });

  it.each([
    ["NO_MATCH", "No passage in the user's documents closely matches this question."],
    ["NO_DOCUMENTS", "The documents in this chat have no searchable text right now"],
    ["NOT_SEARCHED", "The documents weren't searched: the message has no text to search with."],
  ] as const)("explains an empty context (%s)", (mode, note) => {
    const prompt = buildRAGPrompt("Hi", { mode, sources: [] }, [awsGuide]);
    expect(prompt).toContain(`<context>\n${note}`);
    expect(prompt).toContain("<question>\nHi\n</question>");
    expect(prompt).not.toContain("[Source");
  });
});

describe("imageOnlyQuestion", () => {
  it("asks about the image, or images", () => {
    expect(imageOnlyQuestion(1)).toBe("Please analyze this image.");
    expect(imageOnlyQuestion(3)).toBe("Please analyze these images.");
  });
});
