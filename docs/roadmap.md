# TempDLM Roadmap

This document outlines the planned evolution of TempDLM from its Windows-only MVP through cross-platform support and potential framework migration.

---

## v1.0.0 — Windows MVP (Complete)

**Theme:** Core feature parity. Stable, shippable, Windows-only.

**Implemented:**

- File system watching (chokidar, 500ms debounce, inode-based dedup)
- NewFileDialog — timer selection (5m, 30m, 2h, 1d, Never, Custom)
- Timer scheduling with node-schedule, persisted via electron-store
- Startup reconciliation (overdue deletions, re-register future timers)
- Two-layer file lock detection:
  - Layer 1: Windows Restart Manager API (authoritative handle check)
  - Layer 2: Window-title heuristic (catches Notepad-style readers)
- ConfirmDeleteDialog — amber-themed, 15s countdown, fail-open
- SnoozeDialog — shown when Restart Manager reports a real lock
- Queue UI (search, sort, filter, react-window virtual scrolling)
- Settings panel (folder picker, default timer, launch at startup)
- System tray (hide-to-tray, pending count label, quick open)
- Windows installer — NSIS via electron-builder
- Unit test suite — 155 tests across 8 files (Vitest + Testing Library)
- ESLint (v9 flat config) + Prettier + TypeScript strict mode
- `.gitattributes` enforcing LF line endings across the repository
- Separate `eslint.maintainability.mjs` config (naming, complexity, JSDoc)
- GitHub Actions CI — 9-job pipeline (lint, format, typecheck, tests, security audit, maintainability, secret scan, sensitive-file check, docs integrity)
- `.github/SECURITY.md` vulnerability disclosure policy

---

## v1.x — Windows Polish

**Theme:** Quality-of-life improvements without platform expansion.

**Planned:**

- **Download clustering** — group files arriving within a 2-second window into a single dialog (see `docs/technical-challenges.md` Challenge 2)
- **Pattern-based whitelist** — wildcard rules (e.g., `temp_*`) and folder-based rules in addition to extension-based
- **Configurable dialog positioning** — bottom-right, near-tray, near-cursor, center-active-monitor
- **Auto-update** — `electron-updater` with GitHub Releases as the update source
- **Tray icon badge** — file count badge overlay on tray icon
- **Notification integration** — native Windows toast notifications for scheduled/completed deletions
- **Statistics view** — files managed, space reclaimed over time
- **Export/import settings** — JSON export of whitelist rules and preferences

---

## v2.0 — macOS Support

**Theme:** First cross-platform release.

**Key work:**

- **File lock detection on macOS** — replace Restart Manager (Windows-only) with `lsof`-based detection
  ```bash
  lsof -F n -- /path/to/file
  ```
  Window-title heuristic remains valid (AppleScript or `osascript` to query window titles)
- **Tray icon** — macOS menu bar icon (template image for dark/light mode)
- **Hide-to-dock behavior** — macOS convention differs from Windows (no minimize-to-tray equivalent)
- **Login item registration** — `app.setLoginItemSettings()` works but macOS shows a privacy prompt
- **Recycle Bin** — `trash` package already handles macOS Trash; verify behavior
- **Code signing + notarization** — required for Gatekeeper; needs Apple Developer account
- **DMG installer** — electron-builder `--mac` target
- **Layer 2 heuristic on macOS:**
  ```bash
  # AppleScript approach
  osascript -e 'tell application "System Events" to get name of every process whose frontmost is true'
  # or use CGWindowListCopyWindowInfo for all visible windows
  ```

---

## v2.x — Linux Support

**Theme:** Completing the cross-platform trinity.

**Key work:**

- **File lock detection on Linux** — `lsof` or `/proc/<pid>/fd/` symlink inspection
  ```bash
  lsof -F n -- /path/to/file
  # or
  fuser /path/to/file
  ```
- **Window-title heuristic on Linux** — `wmctrl -l` or `xdotool search --name` (X11); Wayland requires `wl-roots` or compositor-specific protocols (fail-open if unavailable)
- **System tray** — `electron-tray` works on most DEs; GNOME requires Shell extension for tray icon visibility
- **Startup registration** — `~/.config/autostart/tempdlm.desktop` XDG standard
- **AppImage + deb + rpm** — electron-builder Linux targets
- **Recycle Bin** — `trash` package supports FreeDesktop Trash spec (`~/.local/share/Trash`)
- **Packaging** — Snap/Flatpak consideration for sandboxed distribution (conflicts with file watching — needs careful permission scoping)

---

## v3.x — Extended Features

**Theme:** Power user features and ecosystem integrations.

**Planned:**

- **Browser extension (Chrome first)** — optional companion extension using `chrome.downloads.onCreated` for pre-download interception and enhanced metadata (original URL, referrer, MIME type)
  - Native messaging bridge to desktop app
  - Falls back gracefully if extension not installed
- **Firefox extension** — after Chrome extension is stable
- **CLI interface** — `tempdlm ls`, `tempdlm cancel <id>`, `tempdlm set <file> <duration>` for power users and scripting
- **REST/IPC API** — allow third-party integrations (e.g., a download manager calling `tempdlm` directly)
- **Advanced clustering UX** — show cluster members in expandable dialog, handle individually option
- **Folder watching** — watch multiple folders beyond just Downloads (configurable)
- **Sync settings** — optional cloud backup of whitelist + settings via a user-provided sync target

---

## Tauri Consideration (Future)

**Theme:** Evaluate framework migration for bundle size and performance.

### Why Consider Tauri

| Factor           | Electron (current)      | Tauri                           |
| ---------------- | ----------------------- | ------------------------------- |
| Bundle size      | ~80-100 MB              | ~5-10 MB                        |
| Memory (idle)    | ~80-120 MB              | ~15-30 MB                       |
| Startup time     | ~1-2s                   | < 500ms                         |
| UI stack         | Chromium + React (same) | WebView2/WebKit + React (same)  |
| Native APIs      | Node.js (mature)        | Rust (powerful, less batteries) |
| Plugin ecosystem | npm (vast)              | Growing                         |

### Key Migration Challenges

1. **File watching** — chokidar → Tauri's `tauri-plugin-fs-watch` or custom Rust
2. **File lock detection** — Node.js `child_process` → Rust `Command::new("powershell")`; the inline C# approach remains valid
3. **electron-store** — replace with `tauri-plugin-store` or direct filesystem JSON
4. **Tray** — `tauri-plugin-tray` (available, less mature than Electron's)
5. **Installer** — electron-builder NSIS → Tauri's built-in WiX (`.msi`) or NSIS bundler
6. **IPC** — Electron `ipcRenderer.invoke` → Tauri `invoke()` (very similar pattern; preload bridge becomes Tauri commands)

### Recommendation

Revisit after v2.x when the feature set is stable. A Tauri port would be a significant rewrite of `src/main/` (into Rust) while keeping `src/renderer/` (React) largely intact. The decision point is user feedback about bundle size vs. the cost of maintaining a Rust codebase.

---

## Version Summary

| Version | Theme               | Status           |
| ------- | ------------------- | ---------------- |
| v1.0.0  | Windows MVP         | **Complete**     |
| v1.x    | Windows polish      | Planned          |
| v2.0    | macOS support       | Planned          |
| v2.x    | Linux support       | Planned          |
| v3.x    | Extended features   | Planned          |
| Tauri   | Framework migration | Under evaluation |
