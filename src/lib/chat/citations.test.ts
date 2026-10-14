import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { parseSourceNumbers, readSourceNumbers, remarkCitations, splitCitations } from "./citations";

describe("splitCitations", () => {
  it("finds single and grouped citations", () => {
    expect(splitCitations("EC2 is compute [Source 1]. RDS too [Source 2, 3].")).toEqual([
      { text: "EC2 is compute ", sources: null },
      { text: "[Source 1]", sources: [1] },
      { text: ". RDS too ", sources: null },
      { text: "[Source 2, 3]", sources: [2, 3] },
      { text: ".", sources: null },
    ]);
  });

  it.each([
    ["[Sources 2, 3]", [2, 3]],
    ["[Source 2, Source 3]", [2, 3]],
    ["[Source 2; Source 3]", [2, 3]],
    ["[Source 2 and 3]", [2, 3]],
    ["[source 4]", [4]],
    ["[Source 2-4]", [2, 3, 4]],
    ["[Source 2–Source 4]", [2, 3, 4]],
    ["[ Source 7 ]", [7]],
    ["[Source 3, 3]", [3]],
  ])("reads %s", (text, sources) => {
    expect(splitCitations(text)).toEqual([{ text, sources }]);
  });

  it("finds adjacent citations separately", () => {
    expect(splitCitations("[Source 1][Source 2]").map((part) => part.sources)).toEqual([[1], [2]]);
  });

  it.each(["[Source]", "[Source one]", "[Source 0]", "Source 1", "[Sourced 1]", "[Source 1 — Report, page 2]"])(
    "leaves %s as text",
    (text) => {
      expect(splitCitations(text)).toEqual([{ text, sources: null }]);
    },
  );

  it("returns plain text whole", () => {
    expect(splitCitations("no citations")).toEqual([{ text: "no citations", sources: null }]);
    expect(splitCitations("")).toEqual([]);
  });
});

describe("parseSourceNumbers", () => {
  it("doesn't expand backwards or runaway ranges", () => {
    expect(parseSourceNumbers("5-2")).toEqual([5]);
    expect(parseSourceNumbers("1-999")).toEqual([1]);
  });
});

describe("readSourceNumbers", () => {
  it("reads the rendered attribute back", () => {
    expect(readSourceNumbers("2 3")).toEqual([2, 3]);
    expect(readSourceNumbers(undefined)).toEqual([]);
  });
});

describe("remarkCitations", () => {
  const render = (markdown: string) =>
    renderToStaticMarkup(
      createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkCitations] }, markdown),
    );

  it("renders citations as <cite> elements carrying their numbers", () => {
    expect(render("Compute [Source 1] and storage [Source 2, 3].")).toBe(
      '<p>Compute <cite data-sources="1">[Source 1]</cite> and storage <cite data-sources="2 3">[Source 2, 3]</cite>.</p>',
    );
  });

  it("finds citations inside formatting, lists and tables", () => {
    const html = render(
      "- **Bold [Source 1]**\n\n| a | b |\n| - | - |\n| x [Source 2] | y |",
    );
    expect(html).toContain('<strong>Bold <cite data-sources="1">[Source 1]</cite></strong>');
    expect(html).toContain('<td>x <cite data-sources="2">[Source 2]</cite></td>');
  });

  it("leaves citations in code alone", () => {
    expect(render("`[Source 1]`")).toBe("<p><code>[Source 1]</code></p>");
    expect(render("```\n[Source 1]\n```")).toBe("<pre><code>[Source 1]\n</code></pre>");
  });
});
