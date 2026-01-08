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
- File deletion operations with lock detection
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
- Tracks file metadata, status, scheduled deletion time
- Supports clustering (grouping related downloads)
- Handles snoozing for files in use

**Status Flow:** `pending` → `scheduled` → `deleting` → `deleted` (or `failed`/`snoozed`)

**UserSettings** - Persistent configuration
- Downloads folder path, launch at startup, default timers
- Whitelist rules (extension/pattern-based)
- UI preferences (theme, dialog position, notifications)

### Critical Workflows

**New File Detection (fileWatcher.ts):**
1. chokidar detects file → 500ms debounce for multi-file downloads
2. Check whitelist rules (may auto-handle without dialog)
3. Check clustering (files within 2s window grouped together)
4. Create QueueItem, send IPC to renderer
5. Show NewFileDialog for timer selection

**Scheduled Deletion (deletionEngine.ts):**
1. Timer expires → Check file existence
2. Check file lock (proper-lockfile + platform-specific detection)
3. If locked: Show SnoozeDialog (retry 10min, up to 3x)
4. If unlocked: Move to Recycle Bin via `trash` package
5. Update QueueItem status, persist to electron-store

**Startup Reconciliation:**
- Load persisted queue from electron-store
- Re-register timers for future deletions
- Process overdue deletions (staggered 500ms apart)
- Remove stale entries for deleted files

## Development Commands

Since this project is in early stages, the following commands are planned:

```bash
# Development
npm install          # Install dependencies
npm run dev          # Start Electron with hot-reload (Vite)

# Building
npm run build        # TypeScript compilation
npm run dist:win     # Create Windows installer (NSIS)
npm run dist:mac     # Create macOS installer (DMG)
npm run dist:linux   # Create Linux packages (AppImage, deb, rpm)

# Testing
npm test             # Run all tests (Vitest)
npm run test:unit    # Unit tests only
npm run test:e2e     # E2E tests (Playwright)
npm run test:watch   # Watch mode for development

# Code Quality
npm run lint         # ESLint + Prettier check
npm run lint:fix     # Auto-fix issues
```

## Implementation Guidelines

### Platform Priority
Windows (Priority 1) → macOS (Priority 2) → Linux (Priority 3)

Start with Windows-only implementation, ensuring clean abstraction layers for future cross-platform support.

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
- Detect file locks before deletion attempts (proper-lockfile)
- Implement retry logic with user notification
- Gracefully handle ENOENT (file deleted externally), EBUSY (in use), EACCES (permissions)

### Whitelist System
Three tiers of rules:
1. Extension-based (e.g., `.exe`, `.pdf`)
2. Pattern-based with wildcards (e.g., `temp_*`)
3. Folder-based (e.g., subdirectories)

Actions: `never-delete` or `auto-delete-after` with preset timer

### Download Clustering Algorithm
Group files arriving within 2-second window into single dialog:
- Same parent directory + 3+ files = archive extraction
- Sequential naming patterns = browser multi-download
- Show batch dialog with option to "Handle individually"

### IPC Communication Pattern
```typescript
// Main -> Renderer events
'file:new', 'file:deleted', 'file:in-use', 'queue:updated'

// Renderer -> Main invocations
'file:set-timer', 'file:cancel', 'file:snooze', 'settings:update'
```

Always use `ipcRenderer.invoke()` for request/response, `ipcRenderer.on()` for events.

## Phase 1 MVP Scope (Windows Only)

Focus areas for initial implementation:
1. Core file watching with chokidar
2. Timer dialog and scheduling system
3. Queue UI with search/sort/filter
4. System tray integration
5. Basic whitelist (extension-based only)
6. Windows installer with NSIS
7. Startup with Windows option

**Explicitly NOT in Phase 1:**
- Browser extension integration (deferred to Phase 3)
- Download clustering (Phase 2)
- Pattern-based whitelist (Phase 2)
- Statistics dashboard (Phase 2)
- macOS/Linux support (Phase 2/3)

## Key Technical Decisions

**Why Electron over Tauri/Flutter/.NET MAUI:**
- Gentlest learning curve (web stack)
- Mature ecosystem with battle-tested file system APIs
- Excellent installer support (electron-builder)
- Cross-platform from day one even if starting Windows-only
- Trade-off: Larger bundle (~80-100MB) vs Tauri (~10MB) but acceptable

**Why file system watching over browser interception:**
- Browser extension would require per-browser development
- Detection delay (200-500ms after download) is imperceptible
- Avoids complexity of native messaging and browser store publishing
- Can revisit in Phase 3 if user feedback demands

**Why Recycle Bin over permanent deletion:**
- Safety net for accidental timer selection
- Aligns with user expectations
- Cross-platform via `trash` package

## Documentation Structure

- `README.md` - Public-facing project overview
- `docs/idea.md` - Vision, user personas, scope, success metrics
- `docs/specifications.md` - Complete technical architecture (817 lines)
- `docs/technical-challenges.md` - Solutions to 8 implementation challenges

Refer to `docs/specifications.md` for:
- Complete dependency list with rationales
- Data model schemas (QueueItem, UserSettings, WhitelistRule)
- UI mockups and keyboard shortcuts
- Platform-specific implementations (Windows/macOS/Linux)
- Error handling strategies
- Logging and crash reporting setup
- electron-builder configuration

Refer to `docs/technical-challenges.md` for:
- Download clustering algorithm
- Multi-strategy file lock detection
- Startup reconciliation logic
- Whitelist matching implementation
- Multi-monitor dialog positioning
- Virtual scrolling for large queues
- NSIS installer configuration
