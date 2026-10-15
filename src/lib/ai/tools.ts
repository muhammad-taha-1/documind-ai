import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ChatDocument } from "@/lib/chat/queries";
import { firstIssueMessage } from "@/lib/chat/validation";
import { getDocumentSummary, getPageChunks } from "@/lib/documents/queries";
import { formatBytes } from "@/lib/format";
import type { SourceChunk } from "@/types";
import type { Toolbox, ToolOutput } from "./chat";
import { formatPageCount, formatPassage, PASSAGE_SEPARATOR, sourceLabel } from "./prompts";
import { searchPassages, TOP_K } from "./rag";
import type { SourceList } from "./sources";

// Tools Claude can call while answering. Claude decides when to call them;
// the code here runs them and reports back. Everything a tool returns is
// text Claude reads, and every passage it returns gets a source number, so
// it can be cited and shown under the reply like the passages from retrieval.

export const MAX_SEARCH_RESULTS = 10;

/**
 * The same for every request: tools come first in the prompt, so changing
 * them would invalidate every cached conversation. The descriptions say
 * *when* to call each tool, because that's how Claude decides.
 */
export const TOOLS = [
  {
    name: "search_documents",
    description:
      "Search the documents in this chat for passages about a topic, matching meaning rather than exact words. " +
      "Use it when the passages you were given don't answer the question: a follow-up about something earlier in " +
      "the conversation (write a query that names the topic, since the user's wording may not), a detail the first " +
      "search missed, or a question about one particular document. Returns the best-matching passages first, " +
      "numbered as sources you can cite.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "What to look for, described the way the document might phrase it, e.g. 'difference between application and network load balancers'",
        },
        document_id: {
          type: "string",
          description: "Search only this document (an ID from the <documents> list). Leave out to search them all.",
        },
        max_results: {
          type: "integer",
          description: `How many passages to return, 1 to ${MAX_SEARCH_RESULTS}. Defaults to ${TOP_K}.`,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_page_content",
    description:
      'Read one page of a document. Use it when the user asks about a specific page ("what\'s on page 4?"), or ' +
      "when you need the text around a passage you were given. Returns the passages covering that page, numbered " +
      "as sources you can cite; the first may begin on the page before.",
    input_schema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "The document, as an ID from the <documents> list" },
        page_number: { type: "integer", description: "The page to read, starting from 1" },
      },
      required: ["document_id", "page_number"],
    },
  },
  {
    name: "get_document_info",
    description:
      "Look up a document's details: file name, file size, page count, upload date and processing status. " +
      "Use it when the user asks about the document itself rather than what it says.",
    input_schema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "The document, as an ID from the <documents> list" },
      },
      required: ["document_id"],
    },
  },
] as const satisfies readonly Anthropic.Beta.BetaTool[];

type ToolName = (typeof TOOLS)[number]["name"];

// Claude's arguments are untrusted input, like a request body: validated
// before use. A failure goes back to Claude as an error it can correct.
const inputSchemas = {
  search_documents: z.object({
    query: z.string().trim().min(1, "query can't be empty").max(1000),
    document_id: z.string().optional(),
    max_results: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional(),
  }),
  get_page_content: z.object({
    document_id: z.string(),
    page_number: z.number().int().min(1),
  }),
  get_document_info: z.object({
    document_id: z.string(),
  }),
} satisfies Record<ToolName, z.ZodType>;

function isToolName(name: string): name is ToolName {
  return Object.hasOwn(inputSchemas, name);
}

export interface ToolContext {
  userId: string;
  /** The chat's documents: the only ones the tools will touch */
  documents: readonly ChatDocument[];
  /** This reply's numbered passages, which tool results add to */
  sources: SourceList;
  signal?: AbortSignal;
}

const failure = (output: string): ToolOutput => ({ output, isError: true });

/** Numbers the passages and formats them for Claude; ones it has already seen are referenced, not repeated */
function passagesFor(chunks: readonly SourceChunk[], sources: SourceList): string {
  return chunks
    .map((chunk) => {
      const { number, isNew } = sources.add(chunk);
      return isNew ? formatPassage(chunk, number) : `${sourceLabel(chunk, number)} (already shown above)`;
    })
    .join(PASSAGE_SEPARATOR);
}

/** The tools, bound to one user, one chat and one reply. */
export function createToolbox(context: ToolContext): Toolbox {
  const { userId, documents, sources, signal } = context;

  function findDocument(id: string): ChatDocument | ToolOutput {
    return (
      documents.find((document) => document.id === id) ??
      failure(`There's no document with ID "${id}" in this chat. Use an ID from the <documents> list.`)
    );
  }

  const run = {
    async search_documents({ query, document_id, max_results }: z.infer<typeof inputSchemas.search_documents>) {
      let scope = documents.map((document) => document.id);
      if (document_id !== undefined) {
        const document = findDocument(document_id);
        if ("isError" in document) return document;
        scope = [document.id];
      }
      const results = await searchPassages(query, scope, userId, { topK: max_results ?? TOP_K, signal });
      return {
        output: results.length === 0 ? "No passages matched that query closely." : passagesFor(results, sources),
        isError: false,
      };
    },

    async get_page_content({ document_id, page_number }: z.infer<typeof inputSchemas.get_page_content>) {
      const document = findDocument(document_id);
      if ("isError" in document) return document;
      if (document.pageCount !== null && page_number > document.pageCount) {
        return failure(`"${document.title}" has ${formatPageCount(document.pageCount)}.`);
      }
      const chunks = await getPageChunks(userId, document.id, page_number);
      return {
        output:
          chunks.length === 0
            ? `Page ${page_number} of "${document.title}" has no text that could be extracted.`
            : passagesFor(chunks, sources),
        isError: false,
      };
    },

    async get_document_info({ document_id }: z.infer<typeof inputSchemas.get_document_info>) {
      const chatDocument = findDocument(document_id);
      if ("isError" in chatDocument) return chatDocument;
      const document = await getDocumentSummary(userId, chatDocument.id);
      if (!document) {
        return failure(`"${chatDocument.title}" has been deleted.`);
      }
      const details = [
        `Title: ${document.title}`,
        `File name: ${document.fileName}`,
        `File size: ${formatBytes(document.fileSize)}`,
        `Pages: ${document.pageCount ?? "unknown"}`,
        `Uploaded: ${document.createdAt}`,
        `Status: ${document.status}${document.errorMessage ? ` (${document.errorMessage})` : ""}`,
        `Passages indexed for search: ${document.embeddedChunks} of ${document.totalChunks}`,
      ];
      return { output: details.join("\n"), isError: false };
    },
  } satisfies { [Name in ToolName]: (input: z.infer<(typeof inputSchemas)[Name]>) => Promise<ToolOutput> };

  function titleOf(id: unknown): string {
    const document = documents.find((candidate) => candidate.id === id);
    return document ? `"${document.title}"` : "a document";
  }

  return {
    definitions: TOOLS,

    describe(name, input) {
      const args = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
      switch (name) {
        case "search_documents": {
          const scope = args.document_id === undefined ? "your documents" : titleOf(args.document_id);
          return `Searched ${scope} for "${String(args.query ?? "")}"`;
        }
        case "get_page_content":
          return `Read page ${String(args.page_number ?? "?")} of ${titleOf(args.document_id)}`;
        case "get_document_info":
          return `Looked up details of ${titleOf(args.document_id)}`;
        default:
          return `Used ${name}`;
      }
    },

    async run(name, input) {
      if (!isToolName(name)) {
        return failure(`There's no tool called "${name}".`);
      }
      const parsed = inputSchemas[name].safeParse(input);
      if (!parsed.success) {
        return failure(`Invalid input: ${firstIssueMessage(parsed.error)}`);
      }
      // Each schema matches its handler; TypeScript can't correlate the two through `name`
      const handler = run[name] as (input: unknown) => Promise<ToolOutput>;
      return handler(parsed.data);
    },
  };
}
