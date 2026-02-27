import fs from "fs";
import path from "path";
import type { UserSettings } from "../shared/types";

// Always use win32 path parsing — this app runs on Windows and receives
// Windows-style paths. Using path.win32 ensures tests on Linux also parse
// backslash-separated paths correctly.
const winPath = path.win32;

// ─── Constants ────────────────────────────────────────────────────────────────

// Reject paths under these system roots to prevent watching/deleting system files.
const BLOCKED_PATH_PREFIXES = [
  "C:\\Windows",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
  "C:\\ProgramData",
];

// ─── Sub-validators ───────────────────────────────────────────────────────────

/**
 * Validates and resolves the downloadsFolder path from a settings patch.
 * @param raw - The raw path string to validate.
 * @returns The resolved canonical path on success, or an object with an error string on failure.
 */
function validateDownloadsFolderField(raw: string): string | { error: string } {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { error: "downloadsFolder must be a non-empty string" };
  }
  if (!winPath.isAbsolute(raw)) {
    return { error: "downloadsFolder must be an absolute path" };
  }
  let resolved: string;
  try {
    resolved = fs.realpathSync(raw);
  } catch {
    return { error: "downloadsFolder does not exist or is not accessible" };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { error: "downloadsFolder does not exist" };
  }
  if (!stat.isDirectory()) {
    return { error: "downloadsFolder must be a directory" };
  }
  const upper = resolved.toUpperCase();
  for (const prefix of BLOCKED_PATH_PREFIXES) {
    if (upper.startsWith(prefix.toUpperCase())) {
      return { error: `downloadsFolder may not be a system path (${prefix})` };
    }
  }
  return resolved;
}

/**
 * Validates the customDefaultMinutes field from a settings patch.
 * @param v - The number value to validate.
 * @returns An error string describing the violation, or null if valid.
 */
function validateCustomDefaultMinutesField(v: number): string | null {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 40320) {
    return "customDefaultMinutes must be an integer between 1 and 40320";
  }
  return null;
}

/**
 * Validates the defaultTimer field from a settings patch.
 * @param v - The timer preset string to validate.
 * @returns An error string describing the violation, or null if valid.
 */
function validateDefaultTimerField(v: string): string | null {
  const allowed = ["5m", "30m", "2h", "1d", "never", "custom"] as const;
  if (!allowed.includes(v as (typeof allowed)[number])) {
    return `defaultTimer must be one of: ${allowed.join(", ")}`;
  }
  return null;
}

/**
 * Validates the dialogPosition field from a settings patch.
 * @param v - The dialog position string to validate.
 * @returns An error string describing the violation, or null if valid.
 */
function validateDialogPositionField(v: string): string | null {
  const allowed = ["center", "bottom-right", "near-tray"] as const;
  if (!allowed.includes(v as (typeof allowed)[number])) {
    return `dialogPosition must be one of: ${allowed.join(", ")}`;
  }
  return null;
}

/**
 * Validates the theme field from a settings patch.
 * @param v - The theme string to validate.
 * @returns An error string describing the violation, or null if valid.
 */
function validateThemeField(v: string): string | null {
  const allowed = ["system", "light", "dark"] as const;
  if (!allowed.includes(v as (typeof allowed)[number])) {
    return `theme must be one of: ${allowed.join(", ")}`;
  }
  return null;
}

/**
 * Validates the launchAtStartup field from a settings patch.
 * @param v - The boolean value to validate.
 * @returns An error string describing the violation, or null if valid.
 */
function validateLaunchAtStartupField(v: boolean): string | null {
  if (typeof v !== "boolean") {
    return "launchAtStartup must be a boolean";
  }
  return null;
}

/**
 * Validates the showNotifications field from a settings patch.
 * @param v - The boolean value to validate.
 * @returns An error string describing the violation, or null if valid.
 */
function validateShowNotificationsField(v: boolean): string | null {
  if (typeof v !== "boolean") {
    return "showNotifications must be a boolean";
  }
  return null;
}

/**
 * Validates the whitelistRules array from a settings patch.
 * @param rules - The whitelist rules array to validate.
 * @returns An error string describing the first violation, or null if valid.
 */
function validateWhitelistRulesField(rules: UserSettings["whitelistRules"]): string | null {
  if (!Array.isArray(rules)) {
    return "whitelistRules must be an array";
  }
  for (const rule of rules) {
    if (typeof rule !== "object" || rule === null) {
      return "Each whitelist rule must be an object";
    }
    if (rule.type === "extension") {
      if (!/^\.[a-z0-9]{1,10}$/i.test(rule.value)) {
        return `Whitelist extension rule value must match /^\\.[a-z0-9]{1,10}$/i, got: "${rule.value}"`;
      }
    } else if (rule.type === "filename") {
      if (
        typeof rule.value !== "string" ||
        rule.value.length < 1 ||
        rule.value.length > 255 ||
        /[/\\]/.test(rule.value)
      ) {
        return `Whitelist filename rule value must be 1–255 chars with no path separators, got: "${rule.value}"`;
      }
    }
  }
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Validates a Partial<UserSettings> payload received from the renderer.
 * Returns null if valid, or an error string describing the first violation.
 * @param patch - The partial settings object to validate.
 * @returns An error string describing the first violation, or null if all fields are valid.
 */
export function validateSettingsPatch(patch: Partial<UserSettings>): string | null {
  if (patch.downloadsFolder !== undefined) {
    const result = validateDownloadsFolderField(patch.downloadsFolder);
    if (typeof result === "object") return result.error;
    // Write the resolved (symlink-free) path back so the rest of the app uses
    // the canonical path.
    patch.downloadsFolder = result;
  }

  if (patch.customDefaultMinutes !== undefined) {
    const error = validateCustomDefaultMinutesField(patch.customDefaultMinutes);
    if (error) return error;
  }

  if (patch.defaultTimer !== undefined) {
    const error = validateDefaultTimerField(patch.defaultTimer);
    if (error) return error;
  }

  if (patch.dialogPosition !== undefined) {
    const error = validateDialogPositionField(patch.dialogPosition);
    if (error) return error;
  }

  if (patch.theme !== undefined) {
    const error = validateThemeField(patch.theme);
    if (error) return error;
  }

  if (patch.launchAtStartup !== undefined) {
    const error = validateLaunchAtStartupField(patch.launchAtStartup);
    if (error) return error;
  }

  if (patch.showNotifications !== undefined) {
    const error = validateShowNotificationsField(patch.showNotifications);
    if (error) return error;
  }

  if (patch.whitelistRules !== undefined) {
    const error = validateWhitelistRulesField(patch.whitelistRules);
    if (error) return error;
  }

  return null;
}
