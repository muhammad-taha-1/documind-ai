import { describe, expect, it } from "vitest";
import { attachmentPath, MAX_IMAGE_SIZE, sanitizeImageName, validateImageFile } from "./attachments";

const file = (overrides: Partial<Pick<File, "name" | "size" | "type">>) => ({
  name: "chart.png",
  size: 1000,
  type: "image/png",
  ...overrides,
});

describe("validateImageFile", () => {
  it("accepts PNG, JPEG, GIF and WebP up to 5 MB", () => {
    for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(validateImageFile(file({ type }))).toBeNull();
    }
    expect(validateImageFile(file({ size: MAX_IMAGE_SIZE }))).toBeNull();
  });

  it("turns away other types, empty files and big ones", () => {
    expect(validateImageFile(file({ type: "image/svg+xml" }))).toBe(
      "Only PNG, JPEG, GIF and WebP images can be attached.",
    );
    expect(validateImageFile(file({ type: "application/pdf" }))).toMatch(/^Only PNG/);
    expect(validateImageFile(file({ size: 0 }))).toBe("chart.png is empty.");
    expect(validateImageFile(file({ size: MAX_IMAGE_SIZE + 1 }))).toBe(
      "chart.png is too large. Images can be up to 5 MB.",
    );
  });
});

describe("sanitizeImageName", () => {
  it("keeps just the file name", () => {
    expect(sanitizeImageName("C:\\Users\\me\\Pictures\\chart.png")).toBe("chart.png");
    expect(sanitizeImageName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeImageName("  my   photo.jpg ")).toBe("my photo.jpg");
  });

  it("names nameless images", () => {
    expect(sanitizeImageName("")).toBe("image");
    expect(sanitizeImageName("folder/")).toBe("image");
  });

  it("bounds the length", () => {
    expect(sanitizeImageName(`${"a".repeat(300)}.png`)).toHaveLength(255);
  });
});

describe("attachmentPath", () => {
  it("points at the authenticated image route", () => {
    expect(attachmentPath("abc-123")).toBe("/api/attachments/abc-123");
  });
});
