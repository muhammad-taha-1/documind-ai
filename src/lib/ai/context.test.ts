import { describe, expect, it, vi } from "vitest";
import type { ChatTurn } from "./chat";
import { findCompactionCut, fitHistory, parseCompactionBlock } from "./context";

const user = (content: string): ChatTurn => ({ role: "user", content });
const assistant = (content: string): ChatTurn => ({ role: "assistant", content });

describe("fitHistory", () => {
  it("keeps everything that fits", () => {
    const turns = [user("aa"), assistant("bb"), user("cc"), assistant("dd")];
    expect(fitHistory(turns, 8)).toEqual(turns);
  });

  it("drops the oldest turns first, and opens on a user turn", () => {
    const turns = [user("1111"), assistant("2222"), user("3333"), assistant("4444")];
    // Room for three turns, but the oldest of those is a reply
    expect(fitHistory(turns, 12)).toEqual([user("3333"), assistant("4444")]);
  });

  it("sends nothing rather than a turn that alone is over budget", () => {
    expect(fitHistory([user("a"), assistant("x".repeat(20))], 10)).toEqual([]);
  });

  it("handles an empty conversation", () => {
    expect(fitHistory([], 10)).toEqual([]);
  });
});

describe("findCompactionCut", () => {
  const exchanges = (count: number) =>
    Array.from({ length: count }, (_, i) => [user(`q${i}`), assistant(`a${i}`)]).flat();

  it("keeps the last exchanges word for word, starting at a question", () => {
    // q0 a0 q1 a1 | q2 a2 q3 a3
    expect(findCompactionCut(exchanges(4), 2)).toBe(4);
  });

  it("returns null when there's nothing older than what's kept", () => {
    expect(findCompactionCut(exchanges(2), 2)).toBeNull();
    expect(findCompactionCut(exchanges(1), 2)).toBeNull();
    expect(findCompactionCut([], 2)).toBeNull();
  });

  it("counts questions, not messages, when replies are missing", () => {
    // Two questions in a row (e.g. sent from two tabs at once)
    const messages = [user("q0"), assistant("a0"), user("q1"), user("q2"), assistant("a2")];
    expect(findCompactionCut(messages, 2)).toBe(2);
  });
});

describe("parseCompactionBlock", () => {
  it("keeps every field exactly as stored, including ones it doesn't know", () => {
    const stored = {
      type: "compaction",
      content: "Summary",
      signature: "sig",
      encrypted_content: null,
      some_future_field: { nested: true },
    };
    expect(parseCompactionBlock("c1", stored)).toEqual(stored);
  });

  it("returns null when there's no summary", () => {
    expect(parseCompactionBlock("c1", null)).toBeNull();
  });

  it("returns null, and logs, for a malformed block", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseCompactionBlock("c1", { type: "compaction", content: "" })).toBeNull();
    expect(parseCompactionBlock("c1", { type: "text", text: "hi" })).toBeNull();
    expect(consoleError).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});
