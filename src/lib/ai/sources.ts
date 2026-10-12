import type { SourceChunk } from "@/types";

/**
 * The numbered passages behind one reply. Retrieval adds the first ones
 * (Source 1, 2, ...); tools add more as Claude finds them, so every passage
 * Claude sees in a turn has one number, and "[Source 7]" means the same
 * thing in the prompt, the tool results and the saved sources.
 */
export class SourceList {
  readonly #sources: SourceChunk[] = [];
  readonly #numbers = new Map<string, number>();

  constructor(initial: readonly SourceChunk[] = []) {
    for (const source of initial) {
      this.add(source);
    }
  }

  /**
   * Gives the passage a number, or returns the one it already has (the same
   * chunk can come back from several searches). `isNew` is false for a
   * passage Claude has already seen this turn.
   */
  add(source: SourceChunk): { number: number; isNew: boolean } {
    const existing = this.#numbers.get(source.id);
    if (existing !== undefined) {
      return { number: existing, isNew: false };
    }
    this.#sources.push(source);
    const number = this.#sources.length;
    this.#numbers.set(source.id, number);
    return { number, isNew: true };
  }

  /** Every passage, in source-number order (index 0 is Source 1) */
  get all(): readonly SourceChunk[] {
    return this.#sources;
  }
}
