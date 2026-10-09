import { differenceInCalendarDays, format } from "date-fns";

const UNITS = ["B", "KB", "MB", "GB"] as const;

/** 1536 -> "1.5 KB", 10485760 -> "10 MB" */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError(`Invalid byte count: ${bytes}`);
  }
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  // Whole bytes have no decimals; larger units show at most one, without a trailing ".0"
  const rounded = unit === 0 ? value : Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[unit]}`;
}

/**
 * A compact "when" for lists, relative to `now`: the time for today,
 * "Yesterday", the weekday within the last week, then the date.
 */
export function formatShortDate(date: Date, now: Date = new Date()): string {
  const daysAgo = differenceInCalendarDays(now, date);
  if (daysAgo <= 0) {
    return format(date, "h:mm a");
  }
  if (daysAgo === 1) {
    return "Yesterday";
  }
  if (daysAgo < 7) {
    return format(date, "EEEE");
  }
  return format(date, date.getFullYear() === now.getFullYear() ? "MMM d" : "MMM d, yyyy");
}

/** e.g. "Oct 9, 2026" */
export function formatDate(date: Date): string {
  return format(date, "MMM d, yyyy");
}

/** Full date and time, e.g. "Oct 9, 2026, 2:05 PM" */
export function formatDateTime(date: Date): string {
  return format(date, "MMM d, yyyy, h:mm a");
}
