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
