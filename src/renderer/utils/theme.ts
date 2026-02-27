import { type UserSettings } from "../../shared/types";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Applies the given theme setting to the document root by toggling the `dark`
 * CSS class. For the `"system"` option, the OS `prefers-color-scheme` media
 * query is consulted at call time.
 * @param theme - The theme value from UserSettings.
 */
export function applyTheme(theme: UserSettings["theme"]): void {
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}
