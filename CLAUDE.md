# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Naming Convention

The project uses a dual naming convention:

- **TempDLM** (proper case) - User-facing product name
  - Application window titles
  - Installer display name ("TempDLM Setup Wizard")
  - System tray tooltip and desktop shortcuts
  - Marketing, documentation, and branding

- **tempdlm** (lowercase) - Technical identifier
  - Repository/package name
  - npm package.json `"name": "tempdlm"`
  - File paths and directories (`~/.config/tempdlm/`)
  - Command-line references
  - App ID (`com.tempdlm.app`)
  - Executable/binary name (`tempdlm.exe`)
  - Code identifiers (IPC namespace: `window.tempdlm`)

**Pattern:** Similar to `docker`/Docker Desktop, `git`/Git, `code`/Visual Studio Code

## Project Overview

TempDLM (Temporary Download Manager) is a cross-platform desktop application built with Electron and React that prevents Downloads folder clutter by letting users set auto-deletion timers when files are downloaded.

**Core Workflow:**

1. File system watcher (chokidar) detects new files in Downloads folder
2. Dialog appears asking user how long to keep the file (5m, 30m, 2h, 1d, Never, Custom)
3. Timer schedules deletion to Recycle Bin (not permanent deletion)
4. Queue management UI allows viewing, searching, sorting, and editing scheduled deletions

## Architecture

### Electron Multi-Process Model

**Main Process (Node.js)** - `src/main/`

- Single source of truth for application state
- File system watching and event debouncing (500ms)
- Timer scheduling and persistence (node-schedule)
- File deletion operations with two-layer lock detection
- System tray management and native OS integration
- IPC handlers for renderer communication

**Renderer Process (Chromium)** - `src/renderer/`

- React-based UI with TypeScript
- Queue visualization with virtual scrolling (react-window)
- User interaction handling
- Communicates with Main via IPC bridge

**Preload Script** - `src/preload/`

- Secure IPC bridge using contextBridge
- Exposes minimal, validated API to renderer
- Enforces context isolation and disables node integration in renderer

### Key Data Models

**QueueItem** - Core entity representing a managed file

- Tracks file metadata, status, scheduled deletion time, inode
- Handles snoozing for files in use
- Supports confirmation flow for potentially-open files

**Status Flow:** `pending` → `scheduled` → `confirming` → `deleting` → `deleted` (or `failed`/`snoozed`)

**UserSettings** - Persistent configuration

- Downloads folder path, launch at startup, default timers
- Whitelist rules (extension-based)
- UI preferences (theme, dialog position, notifications)

### Critical Workflows

**New File Detection (`fileWatcher.ts`):**

1. chokidar detects file → 500ms debounce for multi-file downloads
2. Check whitelist rules (may auto-skip without dialog)
3. Create QueueItem, send IPC to renderer
4. Show NewFileDialog for timer selection

**Scheduled Deletion (`deletionEngine.ts`):**

1. Timer expires → Check file existence
2. Layer 1: Windows Restart Manager API (`spawnSync` PowerShell inline C#) — detects apps holding a file handle
3. If locked: snooze (retry up to 3× at 10-minute intervals)
4. Layer 2: Window-title heuristic (`Get-Process | Where-Object MainWindowTitle`) — catches apps like Notepad that read into memory and release the handle
5. If window title matches: set status `confirming`, send `file:confirm-delete` IPC event, wait up to 15s for user response
   - `keep` → cancel item, return
   - `delete` (or timeout) → fall through to trash
6. Move to Recycle Bin via `trash` package
7. Update QueueItem status, persist to electron-store

**Startup Reconciliation:**

- Load persisted queue from electron-store
- Re-register timers for future deletions
- Process overdue deletions (staggered 500ms apart)
- Remove stale entries for deleted files

## Development Commands

```bash
# Development
npm install          # Install dependencies
npm run dev          # Start Electron with hot-reload (Vite)

# Building
npm run build        # TypeScript + Vite compilation
npm run dist:win     # Create Windows installer (NSIS)
npm run dist:mac     # Create macOS installer (DMG)
npm run dist:linux   # Create Linux packages (AppImage, deb)

# Testing
npm test             # Run all tests (Vitest, watch mode)
npm run test:unit    # Single test run (CI)
npm run test:watch   # Explicit watch mode

# Code Quality
npm run lint         # ESLint (flat config, typescript-eslint)
npm run lint:fix     # Auto-fix lint issues
npm run format       # Prettier — format all files
npm run format:check # Prettier — check only (CI)
```

**Toolchain notes:**

- ESLint v9 flat config lives in `eslint.config.mjs` (`.mjs` avoids needing `"type":"module"` in `package.json`, which would break Electron's CommonJS output)
- Prettier config lives in `.prettierrc`; VSCode extension picks it up automatically
- `tsconfig.json` — renderer + shared types (includes `"jsx": "react-jsx"`, `"types": ["@testing-library/jest-dom"]`)
- `tsconfig.main.json` — main process + preload (CommonJS, `"noEmit": true` to prevent VSCode background compilation to `dist-electron/`)

## Implementation Guidelines

### Platform Priority

Windows (Priority 1) → macOS (Priority 2) → Linux (Priority 3)

Core logic uses clean abstraction layers (platform checks in `deletionEngine.ts`) for future cross-platform support.

### Security Requirements

- Context isolation enabled, node integration disabled in renderer
- Validate all file paths to prevent directory traversal
- Only access user-specified Downloads folder (no escalated privileges)
- Input validation on all IPC handlers

### Performance Targets

- Startup time: < 2 seconds to tray
- Memory usage (idle): < 80 MB
- File detection latency: < 500ms from creation to dialog
- Queue rendering (1000 items): < 100ms with virtual scrolling

### File Operation Safety

- ALWAYS use Recycle Bin (via `trash` package), never permanent deletion
- Detect file locks before deletion attempts (two-layer detection — see Scheduled Deletion workflow above)
- Gracefully handle ENOENT (file deleted externally), EBUSY (in use), EACCES (permissions)

### Whitelist System

Extension-based rules (Phase 1):

- Actions: `never-delete` or `auto-delete-after` with preset timer
- Pattern-based and folder-based rules are planned for Phase 2

### IPC Communication Pattern

```typescript
// Main -> Renderer events
"file:new"; // New file detected, show NewFileDialog
"file:deleted"; // File successfully deleted
"file:in-use"; // File locked, snoozing
"queue:updated"; // Full queue refresh
"file:confirm-delete"; // Layer 2 heuristic matched, await user decision

// Renderer -> Main invocations (ipcRenderer.invoke)
"file:set-timer"; // User picked a timer
"file:cancel"; // User cancelled a scheduled deletion
"file:snooze"; // User snoozed a locked-file dialog
"file:remove"; // Remove item from queue (already deleted externally)
"file:confirm-response"; // User responded to confirmation dialog
"settings:get";
"settings:update";
"queue:get";
"dialog:pick-folder";
```

Always use `ipcRenderer.invoke()` for request/response, `ipcRenderer.on()` for events.

## Phase 1 MVP — COMPLETE (v1.0.0)

All Phase 1 items are implemented and tested:

- [x] Core file watching with chokidar (500ms debounce, inode-based dedup)
- [x] NewFileDialog — timer selection (5m, 30m, 2h, 1d, Never, Custom)
- [x] Timer scheduling with node-schedule + electron-store persistence
- [x] Startup reconciliation (overdue deletions, re-register future timers)
- [x] Two-layer file lock detection (Restart Manager API + window-title heuristic)
- [x] ConfirmDeleteDialog — amber dialog with 15s countdown for heuristic matches
- [x] SnoozeDialog — shown when Restart Manager reports a real lock
- [x] Queue UI with search, sort, filter (react-window virtual scrolling)
- [x] Settings panel — downloads folder picker, default timer, launch at startup
- [x] System tray integration (hide-to-tray, pending count, quick actions)
- [x] Windows installer with NSIS (electron-builder)
- [x] Unit test suite — 121 tests across 8 files (Vitest + Testing Library)
- [x] ESLint (flat config) + Prettier + TypeScript strict mode

**Deferred to later versions:**

- Browser extension integration (v3.x)
- Download clustering (v1.x)
- Pattern-based / folder-based whitelist (v1.x)
- Statistics dashboard (v2.x)
- macOS support (v2.0)
- Linux support (v2.x)
- Tauri rewrite consideration (v3.x)

See `docs/roadmap.md` for the full version roadmap.

## Key Technical Decisions

**Why Electron over Tauri/Flutter/.NET MAUI:**

- Gentlest learning curve (web stack)
- Mature ecosystem with battle-tested file system APIs
- Excellent installer support (electron-builder)
- Cross-platform from day one even if starting Windows-only
- Trade-off: Larger bundle (~80-100MB) vs Tauri (~10MB) — acceptable at this stage

**Why file system watching over browser interception:**

- Browser extension would require per-browser development
- Detection delay (200-500ms after download) is imperceptible
- Avoids complexity of native messaging and browser store publishing
- Optional Chrome extension planned for Phase 3

**Why two-layer lock detection:**

- Layer 1 (Restart Manager) is authoritative but misses apps like Notepad that read files into memory and immediately release the handle
- Layer 2 (window-title heuristic) catches those cases by checking if any visible window title contains the file name
- Layer 2 is fail-open: if the PowerShell call fails or times out, deletion proceeds normally
- 15-second confirmation timeout defaults to `delete` (user intentionally set the timer)

**Why Recycle Bin over permanent deletion:**

- Safety net for accidental timer selection
- Aligns with user expectations
- Cross-platform via `trash` package

## Documentation Structure

- `README.md` - Public-facing project overview and quickstart
- `CLAUDE.md` - AI coding assistant guide (this file)
- `docs/idea.md` - Vision, user personas, scope, success metrics
- `docs/specifications.md` - Complete technical architecture
- `docs/technical-challenges.md` - Solutions to implementation challenges
- `docs/roadmap.md` - Version roadmap (v1.x through Tauri consideration)

Refer to `docs/specifications.md` for:

- Complete dependency list with rationales
- Data model schemas (QueueItem, UserSettings, WhitelistRule)
- UI mockups and keyboard shortcuts
- Platform-specific implementations (Windows/macOS/Linux)
- Error handling strategies
- electron-builder configuration

Refer to `docs/technical-challenges.md` for:

- Download clustering algorithm (Phase 2)
- Two-layer file lock detection (implemented — Challenge 3)
- Window-title heuristic and confirmation flow
- Startup reconciliation logic
- Whitelist matching implementation
- Multi-monitor dialog positioning
- Virtual scrolling for large queues
- NSIS installer configuration
