// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyTheme } from "../utils/theme";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("applyTheme", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it('adds "dark" class for theme="dark"', () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it('removes "dark" class for theme="light"', () => {
    document.documentElement.classList.add("dark");
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it('adds "dark" class for theme="system" when OS prefers dark', () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    applyTheme("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it('removes "dark" class for theme="system" when OS prefers light', () => {
    document.documentElement.classList.add("dark");
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    applyTheme("system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
