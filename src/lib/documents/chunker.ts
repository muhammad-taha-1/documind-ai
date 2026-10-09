/**
 * Splits extracted document text into small, overlapping chunks for embedding.
 *
 * Retrieval works on chunks rather than whole documents: one vector for a
 * 50-page PDF would blur everything together, while a ~375-token chunk is
 * specific enough to match a question. Overlap repeats the end of each chunk
 * at the start of the next, so a sentence cut by a boundary still appears
 * whole in at least one chunk.
 */

export interface PageText {
  pageNumber: number;
  text: string;
}

export interface TextChunk {
  content: string;
  chunkIndex: number;
  /**
   * The page the chunk's own text starts on. Chunks can run across a page
   * break, and the overlap can reach back onto the previous page.
   */
  pageNumber: number;
  /** Rough estimate (~4 characters per token for English text) */
  tokenCount: number;
}

export interface ChunkingOptions {
  /** Maximum characters of new text per chunk (~4 chars ≈ 1 token) */
  chunkSize: number;
  /**
   * Characters repeated from the end of the previous chunk, so a chunk can be
   * up to `chunkSize + chunkOverlap` long
   */
  chunkOverlap: number;
}

export const DEFAULT_CHUNKING_OPTIONS: ChunkingOptions = {
  chunkSize: 1500, // ~375 tokens
  chunkOverlap: 200, // ~50 tokens
};

// Places to split, most natural first. Sentences come before single line
// breaks because PDF text wraps lines mid-sentence; lines still beat words for
// text with no punctuation, like bullet lists. Each separator stays attached
// to the text before it.
const SEPARATORS: readonly RegExp[] = [
  /\n{2,}/g, // paragraphs
  /[.!?]["')\]]*\s+/g, // sentence ends, including closing quotes/brackets
  /\n/g, // lines
  /\s+/g, // words
];

// Pages are joined like paragraphs, so a chunk can continue onto the next page
const PAGE_BREAK = "\n\n";

/** A slice of the combined document text: [start, end) */
interface Span {
  start: number;
  end: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Chunks a document's pages. Pages are combined so chunks can flow across
 * page breaks, and every chunk records the page its text starts on.
 */
export function chunkPages(
  pages: readonly PageText[],
  options: ChunkingOptions = DEFAULT_CHUNKING_OPTIONS,
): TextChunk[] {
  const { chunkSize, chunkOverlap } = options;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError(`chunkSize must be a positive integer, got ${chunkSize}`);
  }
  if (!Number.isInteger(chunkOverlap) || chunkOverlap < 0 || chunkOverlap >= chunkSize) {
    throw new RangeError(
      `chunkOverlap must be an integer from 0 to chunkSize - 1, got ${chunkOverlap}`,
    );
  }

  // Combine the pages, remembering the offset each one starts at
  let text = "";
  const pageStarts: { offset: number; pageNumber: number }[] = [];
  for (const page of pages) {
    const pageText = normalizeText(page.text);
    if (!pageText) continue;
    if (text) text += PAGE_BREAK;
    pageStarts.push({ offset: text.length, pageNumber: page.pageNumber });
    text += pageText;
  }

  // Split into pieces that each fit, then pack neighbouring pieces back
  // together so chunks are as full as possible
  const spans = mergeSpans(splitToFit(text, { start: 0, end: text.length }, chunkSize), chunkSize)
    .filter((span) => /\S/.test(text.slice(span.start, span.end)));

  let pageIndex = 0;
  return spans.map((span, chunkIndex) => {
    // Spans are in order, so the page lookup only ever moves forward
    const ownStart = skipWhitespace(text, span.start);
    while (pageStarts[pageIndex + 1] && pageStarts[pageIndex + 1].offset <= ownStart) {
      pageIndex++;
    }

    const start =
      chunkIndex === 0 ? span.start : overlapStart(text, span, spans[chunkIndex - 1], chunkOverlap);
    const content = text.slice(start, span.end).trim();
    return {
      content,
      chunkIndex,
      pageNumber: pageStarts[pageIndex].pageNumber,
      tokenCount: estimateTokens(content),
    };
  });
}

/** Tidies extracted text so chunks don't spend tokens (or break the DB) on noise. */
function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replaceAll("\0", "") // Postgres text columns reject NUL characters
    .replace(/[^\S\n]+/g, " ") // runs of spaces, tabs, etc. → one space
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Recursively splits a span until every piece fits in `maxSize`, using the
 * most natural separator that actually occurs in it.
 */
function splitToFit(text: string, span: Span, maxSize: number, level = 0): Span[] {
  if (span.end - span.start <= maxSize) {
    return [span];
  }
  const separator = SEPARATORS[level];
  if (!separator) {
    return hardSplit(text, span, maxSize);
  }
  return splitAt(text, span, separator).flatMap((piece) =>
    splitToFit(text, piece, maxSize, level + 1),
  );
}

/** Splits after each match of `separator`, keeping the separator with the text before it. */
function splitAt(text: string, span: Span, separator: RegExp): Span[] {
  const pieces: Span[] = [];
  let pieceStart = span.start;
  for (const match of text.slice(span.start, span.end).matchAll(separator)) {
    const pieceEnd = span.start + match.index + match[0].length;
    if (pieceEnd < span.end) {
      pieces.push({ start: pieceStart, end: pieceEnd });
      pieceStart = pieceEnd;
    }
  }
  pieces.push({ start: pieceStart, end: span.end });
  return pieces;
}

/** Last resort for a single "word" longer than a chunk (a long URL, say). */
function hardSplit(text: string, span: Span, maxSize: number): Span[] {
  const pieces: Span[] = [];
  let start = span.start;
  while (start < span.end) {
    let end = Math.min(start + maxSize, span.end);
    // Don't cut between the two halves of a surrogate pair (emoji etc.)
    if (end < span.end && end - start > 1 && isLowSurrogate(text.charCodeAt(end))) {
      end--;
    }
    pieces.push({ start, end });
    start = end;
  }
  return pieces;
}

/** Greedily joins adjacent spans while the result still fits. */
function mergeSpans(spans: Span[], maxSize: number): Span[] {
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span.end - last.start <= maxSize) {
      last.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/**
 * Where a chunk starts once overlap is added: up to `overlap` characters
 * before its own text, moved forward to a word boundary so it doesn't open
 * on half a word. Never reaches back past the previous chunk's start.
 */
function overlapStart(text: string, span: Span, previous: Span, overlap: number): number {
  const from = Math.max(previous.start, span.start - overlap);
  if (from === previous.start || /\s/.test(text[from - 1])) {
    return from;
  }
  const nextSpace = text.slice(from, span.start).search(/\s/);
  return nextSpace === -1 ? span.start : from + nextSpace;
}

function skipWhitespace(text: string, index: number): number {
  while (index < text.length && /\s/.test(text[index])) index++;
  return index;
}

function isLowSurrogate(charCode: number): boolean {
  return charCode >= 0xdc00 && charCode <= 0xdfff;
}
