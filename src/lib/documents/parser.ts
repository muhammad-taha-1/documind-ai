import { PDFParse } from "pdf-parse";

export interface ParsedPage {
  pageNumber: number;
  text: string;
}

export interface ParsedDocument {
  /** All page text joined with blank lines (paragraph breaks for the chunker) */
  text: string;
  pageCount: number;
  pages: ParsedPage[];
}

/** A parse failure with a message that's safe to show the user. */
export class PdfParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PdfParseError";
  }
}

// pdf.js identifies its errors by `name` (class names are minified in the bundle)
const USER_MESSAGES: Record<string, string> = {
  PasswordException: "This PDF is password-protected. Remove the password and upload it again.",
  InvalidPDFException: "This file couldn't be read as a PDF. It may be damaged.",
  FormatError: "This file couldn't be read as a PDF. It may be damaged.",
};

/**
 * Extracts text from a PDF, page by page.
 *
 * Takes bytes rather than a path so it's easy to test and doesn't care where
 * files are stored. Page numbers are exact (pdf-parse v2 reports real pages),
 * which later lets citations point at the right page.
 */
export async function parsePdf(data: Uint8Array): Promise<ParsedDocument> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    const pages = result.pages.map((page) => ({ pageNumber: page.num, text: page.text.trim() }));
    return {
      // Built from pages rather than result.text, which inserts "-- 1 of 3 --"
      // markers between pages — noise that would end up inside chunks
      text: pages.map((page) => page.text).filter(Boolean).join("\n\n"),
      pageCount: result.total,
      pages,
    };
  } catch (error) {
    // Known problems with the file become user-facing errors. Anything else is
    // unexpected (a bug, or a broken environment) — rethrow it as-is so the
    // pipeline logs it rather than blaming the user's PDF.
    const message = error instanceof Error ? USER_MESSAGES[error.name] : undefined;
    throw message ? new PdfParseError(message, { cause: error }) : error;
  } finally {
    // Releases pdf.js's document and worker resources
    await parser.destroy();
  }
}
