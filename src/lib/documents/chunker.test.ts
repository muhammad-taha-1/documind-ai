import { describe, expect, it } from "vitest";
import { chunkPages, type PageText, type TextChunk } from "./chunker";

const page = (pageNumber: number, text: string): PageText => ({ pageNumber, text });

/** "w0 w1 w2 …" — every word unique, so a chunk's position in the text is unambiguous. */
const words = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, i) => `w${i + offset}`).join(" ");

/**
 * Checks chunks cover `text` in order with nothing dropped: each chunk is a
 * substring of the text, and the next one starts no later than the end of
 * the previous one (plus the whitespace between them).
 */
function expectFullCoverage(chunks: TextChunk[], text: string) {
  let previousStart = 0;
  let previousEnd = 0;
  for (const chunk of chunks) {
    const start = text.indexOf(chunk.content, previousStart);
    expect(start, `chunk ${chunk.chunkIndex} is not part of the text`).toBeGreaterThanOrEqual(0);
    expect(text.slice(previousEnd, start).trim(), `text lost before chunk ${chunk.chunkIndex}`).toBe(
      "",
    );
    previousStart = start;
    previousEnd = Math.max(previousEnd, start + chunk.content.length);
  }
  expect(text.slice(previousEnd).trim()).toBe("");
}

describe("chunkPages", () => {
  it("returns no chunks when there's no text", () => {
    expect(chunkPages([])).toEqual([]);
    expect(chunkPages([page(1, ""), page(2, "  \n\n ")])).toEqual([]);
  });

  it("keeps short text as a single chunk", () => {
    expect(chunkPages([page(1, "Hello world.")])).toEqual([
      { content: "Hello world.", chunkIndex: 0, pageNumber: 1, tokenCount: 3 },
    ]);
  });

  it("prefers paragraph breaks over sentence breaks", () => {
    const first = "First paragraph. It has two sentences.";
    const second = "Second paragraph is here.";
    const chunks = chunkPages([page(1, `${first}\n\n${second}`)], {
      chunkSize: 45,
      chunkOverlap: 0,
    });
    expect(chunks.map((c) => c.content)).toEqual([first, second]);
  });

  it("splits long paragraphs at sentence ends", () => {
    const chunks = chunkPages([page(1, "One two three. Four five six! Seven eight nine?")], {
      chunkSize: 20,
      chunkOverlap: 0,
    });
    expect(chunks.map((c) => c.content)).toEqual([
      "One two three.",
      "Four five six!",
      "Seven eight nine?",
    ]);
  });

  it("splits at line breaks when there's no punctuation, like a bullet list", () => {
    const chunks = chunkPages([page(1, "- apples and pears\n- bread and milk\n- eggs")], {
      chunkSize: 20,
      chunkOverlap: 0,
    });
    expect(chunks.map((c) => c.content)).toEqual(["- apples and pears", "- bread and milk", "- eggs"]);
  });

  it("falls back to word boundaries and never cuts a word in half", () => {
    const text = words(100);
    const chunks = chunkPages([page(1, text)], { chunkSize: 50, chunkOverlap: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(50);
      expect(chunk.content).toMatch(/^w\d+( w\d+)*$/);
    }
    expect(chunks.map((c) => c.content).join(" ")).toBe(text);
  });

  it("hard-splits a single word longer than a chunk", () => {
    const longWord = "x".repeat(25);
    const chunks = chunkPages([page(1, longWord)], { chunkSize: 10, chunkOverlap: 0 });
    expect(chunks.map((c) => c.content)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
  });

  it("doesn't split an emoji across chunks", () => {
    const chunks = chunkPages([page(1, `abc${"😀".repeat(3)}`)], { chunkSize: 4, chunkOverlap: 0 });
    // Every chunk must be valid UTF-16 (no lone surrogate halves)
    for (const chunk of chunks) {
      expect(chunk.content.isWellFormed()).toBe(true);
    }
    expect(chunks.map((c) => c.content).join("")).toBe(`abc${"😀".repeat(3)}`);
  });

  it("starts each chunk with the end of the previous one, on a word boundary", () => {
    const text = words(300);
    const chunks = chunkPages([page(1, text)], { chunkSize: 200, chunkOverlap: 40 });

    expect(chunks.length).toBeGreaterThan(2);
    for (const [i, chunk] of chunks.entries()) {
      expect(chunk.content.length).toBeLessThanOrEqual(240);
      expect(chunk.content).toMatch(/^w\d+( w\d+)*$/);
      if (i === 0) continue;

      // The chunk opens by repeating the last few words of the previous one
      const previousWords = chunks[i - 1].content.split(" ");
      const chunkWords = chunk.content.split(" ");
      const overlapFrom = previousWords.indexOf(chunkWords[0]);
      expect(overlapFrom).toBeGreaterThan(0);
      const repeated = previousWords.slice(overlapFrom);
      expect(chunkWords.slice(0, repeated.length)).toEqual(repeated);
      expect(repeated.join(" ").length).toBeLessThanOrEqual(40);
    }
    expectFullCoverage(chunks, text);
  });

  it("covers the whole text with chunks of the right size (default options)", () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => `${words(60, i * 60)}.`);
    const text = paragraphs.join("\n\n");
    const chunks = chunkPages([page(1, text)]);

    expect(chunks.length).toBeGreaterThan(5);
    chunks.forEach((chunk, i) => {
      expect(chunk.chunkIndex).toBe(i);
      expect(chunk.content.length).toBeLessThanOrEqual(1500 + 200);
      expect(chunk.tokenCount).toBe(Math.ceil(chunk.content.length / 4));
    });
    expectFullCoverage(chunks, text);
  });

  it("records the page each chunk's own text starts on, skipping empty pages", () => {
    // Words w0–w19 are on page 1, w100–w119 on page 3, w200–w219 on page 4. Each
    // page fits in a chunk but no two do, so every chunk starts on a page break
    // and its overlap reaches back onto the previous page.
    const chunks = chunkPages(
      [page(1, words(20, 0)), page(2, ""), page(3, words(20, 100)), page(4, words(20, 200))],
      { chunkSize: 100, chunkOverlap: 30 },
    );
    const pageOfWord = (word: string) => {
      const n = Number(word.slice(1));
      return n < 100 ? 1 : n < 200 ? 3 : 4;
    };

    expect(chunks.map((c) => c.pageNumber)).toEqual([1, 3, 4]);
    expect(chunks[1].content).toMatch(/^w1\d .*w19\n\nw100 /); // overlap from page 1
    for (const [i, chunk] of chunks.entries()) {
      // A chunk's own text starts at its first word the previous chunk didn't have
      const previousWords = new Set(chunks[i - 1]?.content.split(/\s+/));
      const firstOwnWord = chunk.content.split(/\s+/).find((word) => !previousWords.has(word));
      expect(chunk.pageNumber, `chunk ${i}`).toBe(pageOfWord(firstOwnWord!));
    }
  });

  it("lets a chunk continue across a page break", () => {
    const chunks = chunkPages([page(1, "End of page one."), page(2, "Start of page two.")]);
    expect(chunks).toEqual([
      expect.objectContaining({ content: "End of page one.\n\nStart of page two.", pageNumber: 1 }),
    ]);
  });

  it("normalizes whitespace and strips characters Postgres rejects", () => {
    const [chunk] = chunkPages([page(1, "Tabs\tand   spaces\r\nnext\0line \n\n\n\nnew  paragraph")]);
    expect(chunk.content).toBe("Tabs and spaces\nnextline\n\nnew paragraph");
  });

  it.each([
    { chunkSize: 0, chunkOverlap: 0 },
    { chunkSize: 1.5, chunkOverlap: 0 },
    { chunkSize: 100, chunkOverlap: -1 },
    { chunkSize: 100, chunkOverlap: 100 },
  ])("rejects invalid options %o", (options) => {
    expect(() => chunkPages([page(1, "text")], options)).toThrow(RangeError);
  });
});
