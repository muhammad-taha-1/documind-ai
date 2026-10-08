import { describe, expect, it } from "vitest";
import { makePdf } from "@/test/pdf";
import { PdfParseError, parsePdf } from "./parser";

describe("parsePdf", () => {
  it("extracts text page by page with real page numbers", async () => {
    const result = await parsePdf(makePdf(["First page (intro)", "Second page"]));

    expect(result.pageCount).toBe(2);
    expect(result.pages).toEqual([
      { pageNumber: 1, text: "First page (intro)" },
      { pageNumber: 2, text: "Second page" },
    ]);
  });

  it("joins pages with blank lines and no page-marker noise", async () => {
    const result = await parsePdf(makePdf(["Alpha", "Beta", "Gamma"]));
    expect(result.text).toBe("Alpha\n\nBeta\n\nGamma");
    expect(result.text).not.toMatch(/of 3/);
  });

  it("keeps empty pages in the page list but out of the text", async () => {
    const result = await parsePdf(makePdf(["Only text", null]));
    expect(result.pageCount).toBe(2);
    expect(result.pages[1]).toEqual({ pageNumber: 2, text: "" });
    expect(result.text).toBe("Only text");
  });

  it("returns empty text for a PDF with no text layer", async () => {
    const result = await parsePdf(makePdf([null, null]));
    expect(result.pageCount).toBe(2);
    expect(result.text).toBe("");
  });

  it("turns unreadable files into a user-facing PdfParseError", async () => {
    const corrupt = new TextEncoder().encode("%PDF-1.4\nthis is not really a pdf");
    const error = await parsePdf(corrupt).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PdfParseError);
    expect((error as PdfParseError).message).toMatch(/may be damaged/);
    // The original pdf.js error is kept for logging
    expect((error as PdfParseError).cause).toBeInstanceOf(Error);
  });
});
