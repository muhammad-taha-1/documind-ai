import { describe, expect, it } from "vitest";
import { titleFromMessage } from "./title";

describe("titleFromMessage", () => {
  it("uses a short message as-is", () => {
    expect(titleFromMessage("What is EC2?")).toBe("What is EC2?");
  });

  it("collapses whitespace and line breaks", () => {
    expect(titleFromMessage("  Summarize\n\nthe   report  ")).toBe("Summarize the report");
  });

  it("cuts long messages at a word boundary with an ellipsis", () => {
    const title = titleFromMessage(
      "Can you explain how the quarterly revenue numbers compare to last year's forecast and why?",
    );
    expect(title).toBe("Can you explain how the quarterly revenue numbers compare…");
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it("drops trailing punctuation before the ellipsis", () => {
    const title = titleFromMessage(`${"word ".repeat(9)}ending, and then much more text follows here`);
    expect(title.endsWith(",…")).toBe(false);
    expect(title.endsWith("…")).toBe(true);
  });

  it("hard-cuts a long message with no spaces", () => {
    const title = titleFromMessage("x".repeat(100));
    expect(title).toBe(`${"x".repeat(59)}…`);
  });

  it("falls back to the default title for blank input", () => {
    expect(titleFromMessage("   ")).toBe("New Chat");
  });
});
