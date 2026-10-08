import { describe, expect, it, vi } from "vitest";

// Simulates pdf.js failing for a reason that has nothing to do with the file,
// e.g. its worker failing to load in a bundled build
const destroy = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("pdf-parse", () => ({
  PDFParse: class {
    getText = async () => {
      throw new Error('Setting up fake worker failed: "Cannot find module pdf.worker.mjs"');
    };
    destroy = destroy;
  },
}));

const { PdfParseError, parsePdf } = await import("./parser");

describe("parsePdf with an unexpected failure", () => {
  it("rethrows the original error instead of blaming the PDF", async () => {
    const error = await parsePdf(new Uint8Array([1])).catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(PdfParseError);
    expect((error as Error).message).toMatch(/fake worker failed/);
  });

  it("still releases the parser", async () => {
    destroy.mockClear();
    await parsePdf(new Uint8Array([1])).catch(() => {});
    expect(destroy).toHaveBeenCalledOnce();
  });
});
