import { describe, expect, it } from "vitest";
import { inlineContentDisposition } from "./api";

describe("inlineContentDisposition", () => {
  it("names a plain file as is", () => {
    expect(inlineContentDisposition("report.pdf")).toBe(
      `inline; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
  });

  it("keeps quotes and backslashes out of the quoted fallback", () => {
    expect(inlineContentDisposition(`a "b"\\c.pdf`)).toBe(
      `inline; filename="a _b__c.pdf"; filename*=UTF-8''a%20%22b%22%5Cc.pdf`,
    );
  });

  it("percent-encodes non-ASCII names, with an ASCII fallback", () => {
    expect(inlineContentDisposition("résumé (final)'s.pdf")).toBe(
      `inline; filename="r_sum_ (final)'s.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%28final%29%27s.pdf`,
    );
  });

  it("can't be used to inject another header", () => {
    expect(inlineContentDisposition("a\r\nSet-Cookie: x=1.pdf")).not.toMatch(/[\r\n]/);
  });
});
