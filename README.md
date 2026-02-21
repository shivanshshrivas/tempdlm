# TempDLM — Temporary Download Manager

A lightweight Windows desktop app that prevents Downloads folder clutter by letting you set auto-deletion timers the moment a file arrives.

## The Problem

Your Downloads folder is a graveyard. PDFs you printed once, installers you ran, images you shared — they pile up endlessly. You either spend time cleaning manually or let the clutter grow until disk space runs out.

## The Solution

TempDLM watches your Downloads folder. When a new file appears, it asks one simple question: **"How long do you need this?"**

Pick 5 minutes, 30 minutes, 2 hours, 1 day, or Never — then forget about it. When time's up, the file moves to your Recycle Bin (recoverable if needed). If a file is open in another app, TempDLM detects it and asks before acting.

## Features

- **Instant detection** — New files trigger a dialog within 500ms
- **Smart lock detection** — Two-layer check (file handle + window-title scan) prevents deleting open files
- **Safe deletion** — Files go to Recycle Bin, never permanently deleted
- **Snooze for in-use files** — Retry in 10 minutes, up to 3 times
- **Queue management** — View, search, sort, cancel, or edit every scheduled deletion
- **Whitelist rules** — Auto-handle file types (never delete `.exe`, always delete temp files after 5 min)
- **System tray** — Runs quietly in the background, zero chrome
- **Persistent queue** — Timers survive app restarts and are reconciled on startup
- **Settings** — Configure Downloads folder path, startup with Windows, whitelist rules

## Screenshots

_Coming soon_

## Installation

### Windows (Current)

Download the latest installer from [Releases](https://github.com/shivanshshrivas/tempdlm/releases).

Requires Windows 10 or 11.

### macOS / Linux

Coming in v2.x — see [Roadmap](docs/roadmap.md).

## Development

### Prerequisites

- Node.js 20+
- npm 10+

### Setup

```bash
git clone https://github.com/shivanshshrivas/tempdlm.git
cd tempdlm
npm install
npm run dev
```

### Commands

```bash
npm run dev           # Start Electron with hot-reload (Vite)
npm run build         # TypeScript + Vite production build
npm run dist:win      # Create Windows installer (NSIS)

npm test              # Run all tests (Vitest)
npm run test:watch    # Watch mode

npm run lint          # ESLint
npm run lint:fix      # ESLint auto-fix
npm run format        # Prettier (all files)
npm run format:check  # Prettier check (CI)
```

### Project Structure

```plain
tempdlm/
├── src/
│   ├── main/                   # Electron main process (Node.js)
│   │   ├── index.ts            # App entry, IPC handlers, tray, lifecycle
│   │   ├── fileWatcher.ts      # chokidar watcher + debounce + whitelist
│   │   ├── deletionEngine.ts   # Timer scheduling, lock detection, trash
│   │   └── store.ts            # electron-store persistence layer
│   ├── renderer/               # React UI (Chromium)
│   │   ├── App.tsx             # Root component, event subscriptions
│   │   ├── components/         # NewFileDialog, QueueView, SettingsView,
│   │   │                       # ConfirmDeleteDialog
│   │   ├── store/              # Zustand queue store
│   │   └── utils/              # Formatting, sound helpers
│   ├── preload/
│   │   └── index.ts            # Secure contextBridge IPC API
│   └── shared/
│       └── types.ts            # Shared TypeScript types and IPC constants
├── src/main/__tests__/         # Vitest unit tests (main process)
├── src/renderer/__tests__/     # Vitest unit tests (renderer)
├── docs/
│   ├── idea.md                 # Vision, personas, scope, risk
│   ├── specifications.md       # Full technical architecture
│   ├── technical-challenges.md # Solutions to key engineering problems
│   └── roadmap.md              # Version roadmap and future planning
├── .prettierrc                 # Prettier config
├── eslint.config.mjs           # ESLint v9 flat config
├── tsconfig.json               # Renderer TypeScript config
├── tsconfig.main.json          # Main process TypeScript config
└── vite.config.ts              # Vite + Electron build config
```

## Tech Stack

| Layer            | Technology                                                               |
| ---------------- | ------------------------------------------------------------------------ |
| Framework        | Electron 40                                                              |
| UI               | React 19 + TypeScript                                                    |
| Build            | Vite 7 + vite-plugin-electron                                            |
| Styling          | Tailwind CSS 4                                                           |
| State            | Zustand 5                                                                |
| File watching    | chokidar 5                                                               |
| Timer scheduling | node-schedule 2                                                          |
| Trash            | trash 10 (Recycle Bin)                                                   |
| Persistence      | electron-store 11                                                        |
| Lock detection   | proper-lockfile + Windows Restart Manager API (inline C# via PowerShell) |
| Testing          | Vitest 3 + Testing Library                                               |
| Installer        | electron-builder + NSIS                                                  |

## Roadmap

### v1.0.0 — Windows Release ✅ (current)

- [x] Core file watching with chokidar (500ms debounce)
- [x] Timer dialog — 5m, 30m, 2h, 1d, Never, Custom
- [x] Two-layer lock detection (RM API + window-title scan)
- [x] Confirmation dialog for files detected as open in other apps
- [x] Snooze system (10-minute retry, 3 attempts max)
- [x] Queue UI — search, sort, cancel, edit
- [x] Whitelist — extension-based rules
- [x] System tray integration
- [x] Startup with Windows option
- [x] Persistent queue with startup reconciliation
- [x] Settings view (Downloads folder, startup, whitelist)
- [x] Windows installer (NSIS)
- [x] 121 unit tests (Vitest)

### v1.x — Windows Polish

- [ ] Download clustering (batch dialog for archive extractions / multi-file downloads)
- [ ] Pattern-based whitelist (wildcards, regex)
- [ ] Statistics dashboard (files managed, space reclaimed)
- [ ] Keyboard shortcuts
- [ ] Dark / light / system theme
- [ ] Custom notification sounds
- [ ] Playwright E2E tests

### v2.0 — macOS

- [ ] macOS port (DMG installer)
- [ ] macOS trash API via `trash` package (already cross-platform)
- [ ] macOS file lock detection (lsof-based)
- [ ] macOS menu bar / dock integration
- [ ] macOS startup (launchd plist)

### v2.x — Linux

- [ ] Linux port (AppImage, .deb, .rpm)
- [ ] Linux trash API (XDG Trash spec via `trash` package)
- [ ] Linux file lock detection (lsof / fuser)
- [ ] Linux startup (systemd user service / XDG autostart)

### v3.0 — Extended Platform

- [ ] Optional browser extension (Chrome first — `chrome.downloads` API)
- [ ] Multiple folder monitoring
- [ ] Cloud sync of preferences
- [ ] i18n / localization

### Future Consideration — Tauri Rewrite

If bundle size becomes a significant concern, a Tauri rewrite is worth evaluating:

- Bundle drops from ~120MB → ~10MB
- Rust backend replaces Node.js main process; all UI stays React/TypeScript
- File system, tray, and IPC are available in Tauri's API surface
- Not planned until v1.x is stable and adoption validates the investment

## Documentation

- [Project Vision and Scope](docs/idea.md)
- [Technical Specifications](docs/specifications.md)
- [Technical Challenges and Solutions](docs/technical-challenges.md)
- [Version Roadmap](docs/roadmap.md)

## Naming Convention

- **TempDLM** — user-facing (window titles, installer, branding)
- **tempdlm** — technical identifier (package name, binary, paths, IPC namespace)

## License

MIT
