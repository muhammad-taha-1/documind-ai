import type { Parent, PhrasingContent, Root, RootContent, Text } from "mdast";

// Claude cites passages as "[Source 1]" or "[Source 2, 3]" (see
// RAG_SYSTEM_PROMPT). This finds those markers in a reply so the UI can link
// them to the sources listed under it.

/** A marker in the reply text, e.g. "[Source 2, 3]" */
export interface CitationNode extends Parent {
  type: "citation";
  children: PhrasingContent[];
  data: {
    // Rendered as <cite data-sources="2 3">[Source 2, 3]</cite>
    hName: "cite";
    hProperties: { dataSources: string };
  };
}

declare module "mdast" {
  interface PhrasingContentMap {
    citation: CitationNode;
  }
  interface RootContentMap {
    citation: CitationNode;
  }
}

// Each number may be a range ("2-4") or repeat the word ("Source 2, Source 3")
const NUMBER = String.raw`\d{1,3}(?:\s*[-–]\s*(?:Sources?\s+)?\d{1,3})?`;
const SEPARATOR = String.raw`\s*(?:,|;|&|\band\b)\s*(?:Sources?\s+)?`;
const CITATION = String.raw`\[\s*Sources?\s+(${NUMBER}(?:${SEPARATOR}${NUMBER})*)\s*\]`;

// A range can't expand into more source numbers than this
const MAX_RANGE = 20;

/** The source numbers in a citation's list ("2, 4-5" → [2, 4, 5]), in order, without repeats. */
export function parseSourceNumbers(list: string): number[] {
  const numbers = new Set<number>();
  for (const [, first, last] of list.matchAll(/(\d+)(?:\s*[-–]\s*(?:Sources?\s+)?(\d+))?/gi)) {
    const start = Number(first);
    const end = last === undefined ? start : Number(last);
    if (end < start || end - start >= MAX_RANGE) {
      numbers.add(start); // Not a sensible range: keep only what's certain
      continue;
    }
    for (let n = start; n <= end; n++) {
      numbers.add(n);
    }
  }
  return [...numbers].filter((n) => n > 0);
}

/** Splits text into plain text and citations. */
export function splitCitations(text: string): Array<{ text: string; sources: number[] | null }> {
  const parts: Array<{ text: string; sources: number[] | null }> = [];
  let last = 0;
  for (const match of text.matchAll(new RegExp(CITATION, "gi"))) {
    const sources = parseSourceNumbers(match[1]);
    if (sources.length === 0) {
      continue; // "[Source 0]": leave it as text
    }
    if (match.index > last) {
      parts.push({ text: text.slice(last, match.index), sources: null });
    }
    parts.push({ text: match[0], sources });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last), sources: null });
  }
  return parts;
}

/**
 * Remark plugin: turns citation markers in text into `citation` nodes, which
 * render as <cite data-sources="…">. Code spans and blocks aren't text
 * nodes, so markers quoted in code stay as typed.
 */
export function remarkCitations() {
  return (tree: Root) => {
    replaceInChildren(tree);
  };
}

function replaceInChildren(node: Parent) {
  node.children = node.children.flatMap((child): RootContent[] => {
    if (child.type === "text") {
      return citationsIn(child);
    }
    if ("children" in child) {
      replaceInChildren(child);
    }
    return [child];
  });
}

function citationsIn(node: Text): PhrasingContent[] {
  const parts = splitCitations(node.value);
  if (parts.length === 1 && parts[0].sources === null) {
    return [node];
  }
  return parts.map(({ text, sources }) =>
    sources === null
      ? { type: "text", value: text }
      : {
          type: "citation",
          children: [{ type: "text", value: text }],
          data: { hName: "cite", hProperties: { dataSources: sources.join(" ") } },
        },
  );
}

/** The source numbers on a rendered citation's `data-sources` attribute */
export function readSourceNumbers(value: unknown): number[] {
  return typeof value === "string" ? value.split(" ").map(Number).filter(Number.isInteger) : [];
}
