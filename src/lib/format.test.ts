import { describe, expect, it } from "vitest";
import { formatBytes, formatDate, formatDateTime, formatShortDate } from "./format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [10 * 1024 * 1024, "10 MB"],
    [2.25 * 1024 ** 3, "2.3 GB"],
  ])("%d -> %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it("rejects invalid input", () => {
    expect(() => formatBytes(-1)).toThrow(RangeError);
    expect(() => formatBytes(Number.NaN)).toThrow(RangeError);
  });
});

describe("formatShortDate", () => {
  // Local-time constructors, so the expectations hold in any timezone
  const now = new Date(2026, 9, 9, 15, 30); // Fri Oct 9 2026, 3:30 PM

  it.each([
    [new Date(2026, 9, 9, 9, 5), "9:05 AM"],
    [new Date(2026, 9, 9, 0, 0), "12:00 AM"],
    [new Date(2026, 9, 8, 23, 59), "Yesterday"],
    [new Date(2026, 9, 5, 12, 0), "Monday"],
    [new Date(2026, 9, 3, 12, 0), "Saturday"],
    [new Date(2026, 9, 2, 12, 0), "Oct 2"],
    [new Date(2026, 0, 15, 12, 0), "Jan 15"],
    [new Date(2025, 11, 31, 12, 0), "Dec 31, 2025"],
  ])("formats %s as %s", (date, expected) => {
    expect(formatShortDate(date, now)).toBe(expected);
  });

  it("shows the time for dates slightly in the future (clock skew)", () => {
    expect(formatShortDate(new Date(2026, 9, 9, 15, 31), now)).toBe("3:31 PM");
  });
});

describe("formatDate", () => {
  it("shows the date only", () => {
    expect(formatDate(new Date(2026, 9, 9, 14, 5))).toBe("Oct 9, 2026");
  });
});

describe("formatDateTime", () => {
  it("includes the date and time", () => {
    expect(formatDateTime(new Date(2026, 9, 9, 14, 5))).toBe("Oct 9, 2026, 2:05 PM");
  });
});
