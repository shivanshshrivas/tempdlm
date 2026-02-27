import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock fs ──────────────────────────────────────────────────────────────────
// Must be declared before importing the module under test.

vi.mock("fs", () => ({
  default: {
    realpathSync: vi.fn(),
    statSync: vi.fn(),
  },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { validateSettingsPatch } from "../settingsValidator";
import fs from "fs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Configures fs mocks to simulate a valid, accessible directory at the given resolved path. */
function mockValidDir(resolvedPath: string): void {
  vi.mocked(fs.realpathSync).mockReturnValue(resolvedPath);
  vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("validateSettingsPatch", () => {
  it("returns null for an empty patch", () => {
    expect(validateSettingsPatch({})).toBeNull();
  });

  // ── downloadsFolder ──────────────────────────────────────────────────────────

  describe("downloadsFolder", () => {
    beforeEach(() => {
      mockValidDir("C:\\Users\\test\\Downloads");
    });

    it("accepts a valid absolute path", () => {
      expect(validateSettingsPatch({ downloadsFolder: "C:\\Users\\test\\Downloads" })).toBeNull();
    });

    it("writes the resolved canonical path back to the patch", () => {
      vi.mocked(fs.realpathSync).mockReturnValue("C:\\Users\\Test\\Downloads");
      const patch = { downloadsFolder: "C:\\users\\test\\downloads" };
      validateSettingsPatch(patch);
      expect(patch.downloadsFolder).toBe("C:\\Users\\Test\\Downloads");
    });

    it("rejects an empty string", () => {
      expect(validateSettingsPatch({ downloadsFolder: "" })).toContain("non-empty string");
    });

    it("rejects a whitespace-only string", () => {
      expect(validateSettingsPatch({ downloadsFolder: "   " })).toContain("non-empty string");
    });

    it("rejects a relative path", () => {
      expect(validateSettingsPatch({ downloadsFolder: "relative/path" })).toContain(
        "absolute path",
      );
    });

    it("rejects a path that does not exist (realpathSync throws)", () => {
      vi.mocked(fs.realpathSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(validateSettingsPatch({ downloadsFolder: "C:\\NonExistent" })).toContain(
        "does not exist or is not accessible",
      );
    });

    it("rejects a path whose stat call fails", () => {
      vi.mocked(fs.realpathSync).mockReturnValue("C:\\SomePath");
      vi.mocked(fs.statSync).mockImplementation(() => {
        throw new Error("EACCES");
      });
      expect(validateSettingsPatch({ downloadsFolder: "C:\\SomePath" })).toContain(
        "does not exist",
      );
    });

    it("rejects a file path (non-directory)", () => {
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false } as fs.Stats);
      expect(validateSettingsPatch({ downloadsFolder: "C:\\file.txt" })).toContain("directory");
    });

    it("rejects C:\\Windows", () => {
      mockValidDir("C:\\Windows");
      expect(validateSettingsPatch({ downloadsFolder: "C:\\Windows" })).toContain("system path");
    });

    it("rejects C:\\Program Files subdirectory", () => {
      mockValidDir("C:\\Program Files\\MyApp");
      expect(validateSettingsPatch({ downloadsFolder: "C:\\Program Files\\MyApp" })).toContain(
        "system path",
      );
    });

    it("rejects C:\\ProgramData", () => {
      mockValidDir("C:\\ProgramData");
      expect(validateSettingsPatch({ downloadsFolder: "C:\\ProgramData" })).toContain(
        "system path",
      );
    });
  });

  // ── customDefaultMinutes ─────────────────────────────────────────────────────

  describe("customDefaultMinutes", () => {
    it("accepts the minimum value (1)", () => {
      expect(validateSettingsPatch({ customDefaultMinutes: 1 })).toBeNull();
    });

    it("accepts the maximum value (40320)", () => {
      expect(validateSettingsPatch({ customDefaultMinutes: 40320 })).toBeNull();
    });

    it("accepts a mid-range value", () => {
      expect(validateSettingsPatch({ customDefaultMinutes: 60 })).toBeNull();
    });

    it("rejects 0 (below minimum)", () => {
      expect(validateSettingsPatch({ customDefaultMinutes: 0 })).toContain("1 and 40320");
    });

    it("rejects 40321 (above maximum)", () => {
      expect(validateSettingsPatch({ customDefaultMinutes: 40321 })).toContain("1 and 40320");
    });

    it("rejects a float", () => {
      expect(validateSettingsPatch({ customDefaultMinutes: 1.5 })).toContain("integer");
    });
  });

  // ── defaultTimer ─────────────────────────────────────────────────────────────

  describe("defaultTimer", () => {
    it.each(["5m", "30m", "2h", "1d", "never", "custom"] as const)(
      "accepts preset '%s'",
      (timer) => {
        expect(validateSettingsPatch({ defaultTimer: timer })).toBeNull();
      },
    );

    it("rejects an unrecognised value", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(validateSettingsPatch({ defaultTimer: "10m" as any })).toContain(
        "defaultTimer must be one of",
      );
    });
  });

  // ── dialogPosition ───────────────────────────────────────────────────────────

  describe("dialogPosition", () => {
    it.each(["center", "bottom-right", "near-tray"] as const)("accepts position '%s'", (pos) => {
      expect(validateSettingsPatch({ dialogPosition: pos })).toBeNull();
    });

    it("rejects an unrecognised value", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(validateSettingsPatch({ dialogPosition: "top-left" as any })).toContain(
        "dialogPosition must be one of",
      );
    });
  });

  // ── theme ────────────────────────────────────────────────────────────────────

  describe("theme", () => {
    it.each(["system", "light", "dark"] as const)("accepts theme '%s'", (theme) => {
      expect(validateSettingsPatch({ theme })).toBeNull();
    });

    it("rejects an unrecognised value", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(validateSettingsPatch({ theme: "solarized" as any })).toContain(
        "theme must be one of",
      );
    });
  });

  // ── launchAtStartup ──────────────────────────────────────────────────────────

  describe("launchAtStartup", () => {
    it("accepts true", () => {
      expect(validateSettingsPatch({ launchAtStartup: true })).toBeNull();
    });

    it("accepts false", () => {
      expect(validateSettingsPatch({ launchAtStartup: false })).toBeNull();
    });

    it("rejects a non-boolean", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(validateSettingsPatch({ launchAtStartup: 1 as any })).toContain("boolean");
    });
  });

  // ── showNotifications ────────────────────────────────────────────────────────

  describe("showNotifications", () => {
    it("accepts true", () => {
      expect(validateSettingsPatch({ showNotifications: true })).toBeNull();
    });

    it("accepts false", () => {
      expect(validateSettingsPatch({ showNotifications: false })).toBeNull();
    });

    it("rejects a non-boolean", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(validateSettingsPatch({ showNotifications: "yes" as any })).toContain("boolean");
    });
  });

  // ── whitelistRules ───────────────────────────────────────────────────────────

  describe("whitelistRules", () => {
    it("accepts an empty array", () => {
      expect(validateSettingsPatch({ whitelistRules: [] })).toBeNull();
    });

    it("accepts a valid extension rule", () => {
      expect(
        validateSettingsPatch({
          whitelistRules: [
            { id: "1", type: "extension", value: ".pdf", action: "never-delete", enabled: true },
          ],
        }),
      ).toBeNull();
    });

    it("accepts a valid filename rule", () => {
      expect(
        validateSettingsPatch({
          whitelistRules: [
            {
              id: "1",
              type: "filename",
              value: "setup.exe",
              action: "never-delete",
              enabled: true,
            },
          ],
        }),
      ).toBeNull();
    });

    it("rejects a non-array value", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(validateSettingsPatch({ whitelistRules: "rules" as any })).toContain("array");
    });

    it("rejects a null element in the array", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(validateSettingsPatch({ whitelistRules: [null as any] })).toContain("object");
    });

    it("rejects an extension without leading dot", () => {
      expect(
        validateSettingsPatch({
          whitelistRules: [
            { id: "1", type: "extension", value: "pdf", action: "never-delete", enabled: true },
          ],
        }),
      ).toContain("extension rule value must match");
    });

    it("rejects an extension that is too long (>10 chars after dot)", () => {
      expect(
        validateSettingsPatch({
          whitelistRules: [
            {
              id: "1",
              type: "extension",
              value: ".toolongexts", // 11 chars after the dot — exceeds the 1–10 limit
              action: "never-delete",
              enabled: true,
            },
          ],
        }),
      ).toContain("extension rule value must match");
    });

    it("rejects a filename with a forward-slash separator", () => {
      expect(
        validateSettingsPatch({
          whitelistRules: [
            {
              id: "1",
              type: "filename",
              value: "foo/bar.exe",
              action: "never-delete",
              enabled: true,
            },
          ],
        }),
      ).toContain("no path separators");
    });

    it("rejects a filename with a backslash separator", () => {
      expect(
        validateSettingsPatch({
          whitelistRules: [
            {
              id: "1",
              type: "filename",
              value: "foo\\bar.exe",
              action: "never-delete",
              enabled: true,
            },
          ],
        }),
      ).toContain("no path separators");
    });

    it("rejects an empty filename", () => {
      expect(
        validateSettingsPatch({
          whitelistRules: [
            { id: "1", type: "filename", value: "", action: "never-delete", enabled: true },
          ],
        }),
      ).toContain("1–255 chars");
    });

    it("rejects a filename longer than 255 characters", () => {
      expect(
        validateSettingsPatch({
          whitelistRules: [
            {
              id: "1",
              type: "filename",
              value: "a".repeat(256),
              action: "never-delete",
              enabled: true,
            },
          ],
        }),
      ).toContain("1–255 chars");
    });
  });
});
