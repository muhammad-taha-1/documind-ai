import { describe, expect, it } from "vitest";
import {
  hasPdfSignature,
  MAX_FILE_SIZE,
  sanitizeFileName,
  titleFromFileName,
  validateSelectedFile,
} from "./validation";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("hasPdfSignature", () => {
  it("accepts content starting with %PDF-", () => {
    expect(hasPdfSignature(bytes("%PDF-1.7\n..."))).toBe(true);
  });

  it("accepts a signature after a little leading junk", () => {
    expect(hasPdfSignature(bytes("\uFEFF\r\n%PDF-1.4"))).toBe(true);
  });

  it("rejects non-PDF content, even with a .pdf name elsewhere", () => {
    expect(hasPdfSignature(bytes("PK\u0003\u0004 zip file"))).toBe(false);
    expect(hasPdfSignature(bytes("<html>%PDF</html>"))).toBe(false);
    expect(hasPdfSignature(new Uint8Array())).toBe(false);
  });

  it("only searches the first 1 KB", () => {
    const late = new Uint8Array(2048);
    late.set(bytes("%PDF-"), 1500);
    expect(hasPdfSignature(late)).toBe(false);
  });
});

describe("validateSelectedFile", () => {
  const pdf = { name: "report.pdf", type: "application/pdf", size: 1000 };

  it("accepts a normal PDF", () => {
    expect(validateSelectedFile(pdf)).toBeNull();
  });

  it("accepts a .pdf with an empty MIME type", () => {
    expect(validateSelectedFile({ ...pdf, type: "" })).toBeNull();
  });

  it("rejects other file types", () => {
    expect(validateSelectedFile({ name: "notes.docx", type: "application/msword", size: 10 })).toMatch(/only pdf/i);
    expect(validateSelectedFile({ name: "notes.txt", type: "", size: 10 })).toMatch(/only pdf/i);
  });

  it("rejects empty and oversized files", () => {
    expect(validateSelectedFile({ ...pdf, size: 0 })).toMatch(/empty/i);
    expect(validateSelectedFile({ ...pdf, size: MAX_FILE_SIZE })).toBeNull();
    expect(validateSelectedFile({ ...pdf, size: MAX_FILE_SIZE + 1 })).toMatch(/too large/i);
  });
});

describe("sanitizeFileName", () => {
  it("strips directory parts", () => {
    expect(sanitizeFileName("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(sanitizeFileName("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
  });

  it("falls back for blank names and caps the length", () => {
    expect(sanitizeFileName("   ")).toBe("document.pdf");
    expect(sanitizeFileName(`${"a".repeat(300)}.pdf`)).toHaveLength(255);
  });
});

describe("titleFromFileName", () => {
  it("drops the extension and tidies whitespace", () => {
    expect(titleFromFileName("Quarterly_report  2024.PDF")).toBe("Quarterly_report 2024");
  });

  it("falls back when nothing is left", () => {
    expect(titleFromFileName(".pdf")).toBe("Untitled document");
  });
});
