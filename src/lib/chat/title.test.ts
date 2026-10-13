import { describe, expect, it } from "vitest";
import { cleanGeneratedTitle, titleFromMessage } from "./title";

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

describe("cleanGeneratedTitle", () => {
  it.each([
    ["AWS Load Balancer Types", "AWS Load Balancer Types"],
    ['"AWS Load Balancer Types"', "AWS Load Balancer Types"],
    ["“Resume Feedback”", "Resume Feedback"],
    ["Title: Resume Feedback", "Resume Feedback"],
    ["# **Resume Feedback**", "Resume Feedback"],
    ["Resume feedback.", "Resume feedback"],
    ["Resume  feedback\n\nThis title fits because…", "Resume feedback"],
  ])("%j -> %j", (raw, expected) => {
    expect(cleanGeneratedTitle(raw)).toBe(expected);
  });

  it("shortens a title that ignored the length limit", () => {
    const title = cleanGeneratedTitle("word ".repeat(30));
    expect(title?.length).toBeLessThanOrEqual(60);
    expect(title?.endsWith("…")).toBe(true);
  });

  it("returns null when nothing usable is left", () => {
    expect(cleanGeneratedTitle("")).toBeNull();
    expect(cleanGeneratedTitle('  ""  ')).toBeNull();
  });
});
