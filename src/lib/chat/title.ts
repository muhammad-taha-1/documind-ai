const MAX_TITLE_LENGTH = 60;

/**
 * A conversation title from its first message: whitespace collapsed, cut at
 * a word boundary with an ellipsis if it's long.
 */
export function titleFromMessage(message: string): string {
  const text = message.replace(/\s+/g, " ").trim();
  if (text.length <= MAX_TITLE_LENGTH) {
    return text || "New Chat";
  }
  const cut = text.slice(0, MAX_TITLE_LENGTH - 1);
  const lastSpace = cut.lastIndexOf(" ");
  // Fall back to a hard cut when there's no reasonable word boundary
  const base = lastSpace > MAX_TITLE_LENGTH / 2 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s.,;:!?-]+$/, "")}…`;
}
