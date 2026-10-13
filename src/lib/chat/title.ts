const MAX_TITLE_LENGTH = 60;

/** Collapses whitespace and cuts at a word boundary with an ellipsis if it's long. */
function shorten(text: string): string {
  if (text.length <= MAX_TITLE_LENGTH) {
    return text;
  }
  const cut = text.slice(0, MAX_TITLE_LENGTH - 1);
  const lastSpace = cut.lastIndexOf(" ");
  // Fall back to a hard cut when there's no reasonable word boundary
  const base = lastSpace > MAX_TITLE_LENGTH / 2 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s.,;:!?-]+$/, "")}…`;
}

/**
 * A conversation title from its first message: whitespace collapsed, cut at
 * a word boundary with an ellipsis if it's long. The fallback when no
 * generated title is available.
 */
export function titleFromMessage(message: string): string {
  return shorten(message.replace(/\s+/g, " ").trim()) || "New Chat";
}

/**
 * Tidies a title written by the model, or returns null if nothing usable is
 * left: models sometimes add quotes, a "Title:" label, markdown or a full stop.
 */
export function cleanGeneratedTitle(raw: string): string | null {
  const firstLine = raw.trim().split("\n")[0] ?? "";
  const title = firstLine
    .replace(/^#+\s*/, "") // markdown heading
    .replace(/^title\s*:\s*/i, "")
    .replace(/[*_`]/g, "") // markdown emphasis
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.。!]+$/, "")
    .trim();
  return title ? shorten(title) : null;
}
