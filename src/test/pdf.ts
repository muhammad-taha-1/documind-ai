/**
 * Builds a small, valid PDF for tests — one page per entry, with that text
 * drawn on it. `null` makes a page with no text at all (like a scanned image).
 */
export function makePdf(pages: (string | null)[]): Uint8Array<ArrayBuffer> {
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
  const fontRef = 3 + pages.length * 2;
  const kids: string[] = [];

  for (const text of pages) {
    const escaped = text?.replace(/[\\()]/g, (char) => `\\${char}`);
    const content = escaped === undefined ? "" : `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
    const pageRef = objects.length + 1;
    kids.push(`${pageRef} 0 R`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pageRef + 1} 0 R ` +
        `/Resources << /Font << /F1 ${fontRef} 0 R >> >> >>`,
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}
