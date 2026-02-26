/**
 * Format a byte count into a human-readable string.
 * e.g. 1024 → "1.0 KB", 1_500_000 → "1.4 MB"
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Format a future Unix timestamp (ms) as a countdown string.
 * e.g. "2h 14m", "45s", "Overdue"
 */
export function formatCountdown(scheduledFor: number): string {
  const diff = scheduledFor - Date.now();
  if (diff <= 0) return "Overdue";

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Truncate a string in the middle, preserving both the start and end.
 * Useful for filenames where the extension and suffix matter.
 * e.g. "very_long_filename_info (1).pdf" → "very_long_file…nfo (1).pdf"
 */
export function middleTruncate(text: string, maxLength = 48): string {
  if (text.length <= maxLength) return text;
  const front = Math.floor((maxLength - 1) / 2);
  const back = maxLength - 1 - front;
  return text.slice(0, front) + "…" + text.slice(-back);
}

/**
 * Convert a timer preset label to minutes.
 */
export function presetToMinutes(preset: "5m" | "30m" | "2h" | "1d"): number {
  switch (preset) {
    case "5m":
      return 5;
    case "30m":
      return 30;
    case "2h":
      return 120;
    case "1d":
      return 1440;
  }
}
