import { describe, expect, it } from "vitest";
import { highlightMatches } from "./highlight";

describe("highlightMatches", () => {
  it("marks every match, ignoring case and keeping the text's own case", () => {
    expect(highlightMatches("Load balancers: an Application LOAD balancer", "load")).toEqual([
      { text: "Load", match: true },
      { text: " balancers: an Application ", match: false },
      { text: "LOAD", match: true },
      { text: " balancer", match: false },
    ]);
  });

  it("matches regex characters literally", () => {
    expect(highlightMatches("costs $5 (or 99.9%) [approx]", "(or 99.9%)")).toEqual([
      { text: "costs $5 ", match: false },
      { text: "(or 99.9%)", match: true },
      { text: " [approx]", match: false },
    ]);
    expect(highlightMatches("a.b axb", ".")).toEqual([
      { text: "a", match: false },
      { text: ".", match: true },
      { text: "b axb", match: false },
    ]);
  });

  it("returns the text unmarked without a query or a match", () => {
    expect(highlightMatches("text", "")).toEqual([{ text: "text", match: false }]);
    expect(highlightMatches("text", "zzz")).toEqual([{ text: "text", match: false }]);
    expect(highlightMatches("", "")).toEqual([]);
  });
});
