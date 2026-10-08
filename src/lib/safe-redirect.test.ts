import { describe, expect, it } from "vitest";
import { getSafeRedirect } from "./safe-redirect";

describe("getSafeRedirect", () => {
  it("keeps same-origin paths, including query and hash", () => {
    expect(getSafeRedirect("/chat/abc")).toBe("/chat/abc");
    expect(getSafeRedirect("/documents?page=2#top")).toBe("/documents?page=2#top");
  });

  it("falls back when the value is missing or not a single string", () => {
    expect(getSafeRedirect(undefined)).toBe("/dashboard");
    expect(getSafeRedirect("")).toBe("/dashboard");
    expect(getSafeRedirect(["/chat", "/documents"])).toBe("/dashboard");
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "dashboard",
  ])("rejects %s", (value) => {
    expect(getSafeRedirect(value)).toBe("/dashboard");
  });

  it("uses a custom fallback", () => {
    expect(getSafeRedirect("https://evil.example", "/chat")).toBe("/chat");
  });
});
