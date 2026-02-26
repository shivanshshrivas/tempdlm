import { describe, it, expect } from "vitest";
import { formatBytes, formatCountdown, presetToMinutes, middleTruncate } from "../utils/format";

describe("formatBytes", () => {
  it("formats 0 bytes", () => expect(formatBytes(0)).toBe("0 B"));
  it("formats bytes", () => expect(formatBytes(500)).toBe("500 B"));
  it("formats kilobytes", () => expect(formatBytes(1024)).toBe("1.0 KB"));
  it("formats megabytes", () => expect(formatBytes(1_500_000)).toBe("1.4 MB"));
  it("formats gigabytes", () => expect(formatBytes(2_000_000_000)).toBe("1.9 GB"));
});

describe("formatCountdown", () => {
  it('returns "Overdue" for past timestamps', () => {
    expect(formatCountdown(Date.now() - 1000)).toBe("Overdue");
  });

  it("formats seconds only", () => {
    expect(formatCountdown(Date.now() + 45_000)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatCountdown(Date.now() + 5 * 60_000 + 30_000)).toBe("5m 30s");
  });

  it("formats hours and minutes", () => {
    expect(formatCountdown(Date.now() + 2 * 3_600_000 + 14 * 60_000)).toBe("2h 14m");
  });

  it("formats days and hours", () => {
    expect(formatCountdown(Date.now() + 1 * 86_400_000 + 3 * 3_600_000)).toBe("1d 3h");
  });
});

describe("presetToMinutes", () => {
  it("5m → 5", () => expect(presetToMinutes("5m")).toBe(5));
  it("30m → 30", () => expect(presetToMinutes("30m")).toBe(30));
  it("2h → 120", () => expect(presetToMinutes("2h")).toBe(120));
  it("1d → 1440", () => expect(presetToMinutes("1d")).toBe(1440));
});

describe("middleTruncate", () => {
  it("returns short strings unchanged", () => {
    expect(middleTruncate("short.txt")).toBe("short.txt");
  });

  it("returns string exactly at maxLength unchanged", () => {
    const s = "a".repeat(48);
    expect(middleTruncate(s)).toBe(s);
  });

  it("truncates long strings with ellipsis in the middle", () => {
    const result = middleTruncate("very_long_filename_with_important_info_at_the_end (1).pdf");
    expect(result).toContain("…");
    expect(result.startsWith("very_long_filename_with")).toBe(true);
    expect(result.endsWith("(1).pdf")).toBe(true);
  });

  it("result length never exceeds maxLength", () => {
    const long = "a".repeat(100);
    expect([...middleTruncate(long)].length).toBeLessThanOrEqual(48);
  });

  it("respects a custom maxLength", () => {
    const result = middleTruncate("abcdefghijklmnopqrstuvwxyz", 10);
    expect([...result].length).toBeLessThanOrEqual(10);
    expect(result).toContain("…");
    expect(result.startsWith("abcd")).toBe(true);
    expect(result.endsWith("wxyz")).toBe(true);
  });
});
