import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatDocument } from "@/lib/chat/queries";
import type { DocumentChunkResult, DocumentSummary, SourceChunk } from "@/types";

const searchPassages = vi.hoisted(() => vi.fn<() => Promise<DocumentChunkResult[]>>());
vi.mock("./rag", () => ({ searchPassages, TOP_K: 5 }));

const documentQueries = vi.hoisted(() => ({
  getDocumentSummary: vi.fn<() => Promise<DocumentSummary | null>>(),
  getPageChunks: vi.fn<() => Promise<SourceChunk[]>>(),
}));
vi.mock("@/lib/documents/queries", () => documentQueries);

const { createToolbox, TOOLS } = await import("./tools");
const { SourceList } = await import("./sources");

const guide: ChatDocument = { id: "doc-guide", title: "AWS Guide", pageCount: 10 };
const resume: ChatDocument = { id: "doc-resume", title: "Resume", pageCount: 2 };

function passage(id: string, overrides: Partial<SourceChunk> = {}): SourceChunk {
  return {
    id,
    content: `text of ${id}`,
    pageNumber: 3,
    chunkIndex: 0,
    documentId: guide.id,
    documentTitle: guide.title,
    similarity: 0.5,
    ...overrides,
  };
}

let sources: InstanceType<typeof SourceList>;
const signal = new AbortController().signal;

function toolbox() {
  return createToolbox({ userId: "user-1", documents: [guide, resume], sources, signal });
}

beforeEach(() => {
  vi.resetAllMocks();
  // Retrieval already gave Claude two passages: Sources 1 and 2
  sources = new SourceList([passage("given-1"), passage("given-2")]);
});

describe("TOOLS", () => {
  it("defines each tool once, with a schema", () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual(["search_documents", "get_page_content", "get_document_info"]);
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(50);
      expect(tool.input_schema.type).toBe("object");
    }
  });
});

describe("search_documents", () => {
  it("searches all the chat's documents and numbers new passages after the existing ones", async () => {
    searchPassages.mockResolvedValue([
      { ...passage("found"), similarity: 0.61 } as DocumentChunkResult,
      { ...passage("given-2"), similarity: 0.4 } as DocumentChunkResult,
    ]);

    const result = await toolbox().run("search_documents", { query: "  load balancers " });

    expect(searchPassages).toHaveBeenCalledWith("load balancers", [guide.id, resume.id], "user-1", {
      topK: 5,
      signal,
    });
    expect(result).toEqual({
      output: [
        "[Source 3 — AWS Guide, page 3]\ntext of found",
        // Claude already has this one, so it isn't sent again
        "[Source 2 — AWS Guide, page 3] (already shown above)",
      ].join("\n\n---\n\n"),
      isError: false,
    });
    expect(sources.all.map((source) => source.id)).toEqual(["given-1", "given-2", "found"]);
  });

  it("can search one document, for more results", async () => {
    searchPassages.mockResolvedValue([]);

    const result = await toolbox().run("search_documents", {
      query: "experience",
      document_id: resume.id,
      max_results: 8,
    });

    expect(searchPassages).toHaveBeenCalledWith("experience", [resume.id], "user-1", { topK: 8, signal });
    expect(result).toEqual({ output: "No passages matched that query closely.", isError: false });
  });

  it("refuses documents outside the chat", async () => {
    const result = await toolbox().run("search_documents", { query: "x", document_id: "someone-elses" });

    expect(result).toEqual({
      output: expect.stringContaining('no document with ID "someone-elses" in this chat'),
      isError: true,
    });
    expect(searchPassages).not.toHaveBeenCalled();
  });
});

describe("get_page_content", () => {
  it("returns the passages covering the page as numbered sources", async () => {
    documentQueries.getPageChunks.mockResolvedValue([
      passage("before", { pageNumber: 6, similarity: null }),
      passage("on-page", { pageNumber: 7, similarity: null }),
    ]);

    const result = await toolbox().run("get_page_content", { document_id: guide.id, page_number: 7 });

    expect(documentQueries.getPageChunks).toHaveBeenCalledWith("user-1", guide.id, 7);
    expect(result.output).toBe(
      "[Source 3 — AWS Guide, page 6]\ntext of before\n\n---\n\n[Source 4 — AWS Guide, page 7]\ntext of on-page",
    );
  });

  it("explains a page past the end", async () => {
    const result = await toolbox().run("get_page_content", { document_id: resume.id, page_number: 3 });

    expect(result).toEqual({ output: '"Resume" has 2 pages.', isError: true });
    expect(documentQueries.getPageChunks).not.toHaveBeenCalled();
  });

  it("says when a page has no text", async () => {
    documentQueries.getPageChunks.mockResolvedValue([]);

    const result = await toolbox().run("get_page_content", { document_id: guide.id, page_number: 2 });

    expect(result).toEqual({ output: 'Page 2 of "AWS Guide" has no text that could be extracted.', isError: false });
  });
});

describe("get_document_info", () => {
  it("describes the document", async () => {
    documentQueries.getDocumentSummary.mockResolvedValue({
      id: guide.id,
      title: "AWS Guide",
      fileName: "aws.pdf",
      fileSize: 2_500_000,
      pageCount: 10,
      status: "READY",
      errorMessage: null,
      totalChunks: 12,
      embeddedChunks: 12,
      createdAt: "2026-10-08T09:30:00.000Z",
    });

    const result = await toolbox().run("get_document_info", { document_id: guide.id });

    expect(documentQueries.getDocumentSummary).toHaveBeenCalledWith("user-1", guide.id);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("File name: aws.pdf");
    expect(result.output).toContain("Pages: 10");
    expect(result.output).toContain("Uploaded: 2026-10-08T09:30:00.000Z");
    expect(result.output).toContain("Passages indexed for search: 12 of 12");
  });

  it("reports a document deleted since the chat started", async () => {
    documentQueries.getDocumentSummary.mockResolvedValue(null);

    const result = await toolbox().run("get_document_info", { document_id: guide.id });

    expect(result).toEqual({ output: '"AWS Guide" has been deleted.', isError: true });
  });
});

describe("input validation", () => {
  it.each([
    ["search_documents", { query: "   " }, /query can't be empty/],
    ["search_documents", { query: "x", max_results: 50 }, /max_results/],
    ["search_documents", {}, /query/],
    ["get_page_content", { document_id: guide.id, page_number: 0 }, /page_number/],
    ["get_page_content", { document_id: guide.id, page_number: 2.5 }, /page_number/],
    ["get_document_info", { document_id: 7 }, /document_id/],
  ])("rejects bad input to %s: %j", async (name, input, message) => {
    const result = await toolbox().run(name, input);
    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/^Invalid input: /);
    expect(result.output).toMatch(message);
  });

  it("rejects tools that don't exist, including inherited property names", async () => {
    for (const name of ["delete_everything", "constructor", "toString"]) {
      expect(await toolbox().run(name, {})).toEqual({ output: `There's no tool called "${name}".`, isError: true });
    }
  });
});

describe("describe", () => {
  it.each([
    ["search_documents", { query: "ALB vs NLB" }, 'Searched your documents for "ALB vs NLB"'],
    ["search_documents", { query: "skills", document_id: resume.id }, 'Searched "Resume" for "skills"'],
    ["get_page_content", { document_id: guide.id, page_number: 7 }, 'Read page 7 of "AWS Guide"'],
    ["get_document_info", { document_id: "unknown" }, "Looked up details of a document"],
    ["mystery_tool", null, "Used mystery_tool"],
  ])("labels %s %j", (name, input, label) => {
    expect(toolbox().describe(name, input)).toBe(label);
  });
});
