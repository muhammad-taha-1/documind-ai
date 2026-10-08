// Upload rules shared by the browser (fast feedback) and the API (enforcement).
// Keep this file free of Node imports so client components can use it.

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const PDF_MIME_TYPE = "application/pdf";

const MAX_TITLE_LENGTH = 200;
const MAX_FILE_NAME_LENGTH = 255;

// Every PDF contains "%PDF-" near the start. pdf.js tolerates a little junk
// before it, so we look within the first 1 KB rather than at byte 0 only.
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const SIGNATURE_SEARCH_WINDOW = 1024;

/**
 * True if the bytes look like a PDF. The browser-reported MIME type and file
 * extension are both chosen by the client, so the server checks content instead.
 */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, SIGNATURE_SEARCH_WINDOW) - PDF_SIGNATURE.length;
  for (let start = 0; start <= end; start++) {
    if (PDF_SIGNATURE.every((byte, i) => bytes[start + i] === byte)) {
      return true;
    }
  }
  return false;
}

/** Client-side pre-check. Returns an error message, or null if the file looks OK. */
export function validateSelectedFile(file: Pick<File, "name" | "size" | "type">): string | null {
  // Some systems report an empty MIME type for PDFs, so fall back to the extension
  const looksLikePdf =
    file.type === PDF_MIME_TYPE || (file.type === "" && /\.pdf$/i.test(file.name));
  if (!looksLikePdf) {
    return "Only PDF files are supported.";
  }
  if (file.size === 0) {
    return "This file is empty.";
  }
  if (file.size > MAX_FILE_SIZE) {
    return "File is too large. The maximum size is 10 MB.";
  }
  return null;
}

/** The name to store for display: no directory parts, bounded length. Never used in paths. */
export function sanitizeFileName(name: string): string {
  const baseName = name.split(/[\\/]/).pop()?.trim() ?? "";
  return (baseName || "document.pdf").slice(0, MAX_FILE_NAME_LENGTH);
}

/** "Quarterly_report  2024.PDF" -> "Quarterly_report 2024" */
export function titleFromFileName(fileName: string): string {
  const title = sanitizeFileName(fileName)
    .replace(/\.pdf$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return (title || "Untitled document").slice(0, MAX_TITLE_LENGTH);
}
