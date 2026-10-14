/**
 * Splits text into the parts that match `query` (ignoring case) and the
 * parts between, so a search result can mark what it matched.
 */
export function highlightMatches(text: string, query: string): Array<{ text: string; match: boolean }> {
  if (!query) {
    return text ? [{ text, match: false }] : [];
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The capture group makes split() keep the matches, at the odd indexes
  return text
    .split(new RegExp(`(${escaped})`, "iu"))
    .map((part, i) => ({ text: part, match: i % 2 === 1 }))
    .filter((part) => part.text !== "");
}
