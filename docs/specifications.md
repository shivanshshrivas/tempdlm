# Technical Specifications: TempDLM

## Executive Summary

TempDLM is a cross-platform desktop application built with Electron and React, providing automated download file management through user-defined deletion timers. This document defines the complete technical architecture, technology choices, and implementation details.

---

## Technology Stack Decision

### Framework Selection: Electron + React

After evaluating the major cross-platform desktop frameworks, **Electron** is recommended for the following reasons:

| Framework       | Pros                                                                                                                | Cons                                                                   | Verdict              |
| --------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------- |
| **Electron**    | Mature ecosystem, excellent tooling, vast npm library access, React/Vue/Svelte compatible, proven installer support | Larger bundle size (~150MB), higher memory usage                       | **Selected**         |
| Tauri           | Smaller bundle (~10MB), lower memory, Rust backend                                                                  | Younger ecosystem, steeper learning curve, fewer ready-made components | Future consideration |
| Flutter Desktop | Single codebase with mobile, good performance                                                                       | Desktop support less mature, Dart ecosystem smaller                    | Not recommended      |
| .NET MAUI       | Native Windows performance, C# familiarity                                                                          | macOS support weaker, UI toolkit limitations                           | Not recommended      |
| Qt (Python/C++) | Truly native, excellent performance                                                                                 | Complex build process, licensing considerations                        | Not recommended      |

**Rationale for Electron:**

1. User has limited desktop app experience - Electron's web-based stack (HTML/CSS/JS) has the gentlest learning curve
2. Installer support is excellent via Electron Forge/Builder
3. React ecosystem provides battle-tested UI components
4. File system APIs and OS integration are well-documented
5. System tray support is first-class
6. Cross-platform from day one, even if starting Windows-only

**Bundle Size Mitigation:**

- Use Electron Forge with proper tree-shaking
- Lazy load non-critical modules
- Target ~80-100MB installed size (acceptable for desktop apps)

---

## Architecture Overview

```plain
+------------------------------------------------------------------+
|                         TempDLM Application                      |
+------------------------------------------------------------------+
|  Renderer Process (React UI)                                     |
|  +---------------------------+  +-----------------------------+  |
|  |    Main Window            |  |    Notification Dialog      |  |
|  |  - Queue List View        |  |  - Timer Selection          |  |
|  |  - Search/Filter/Sort     |  |  - File Info Display        |  |
|  |  - Settings Panel         |  |  - Quick Actions            |  |
|  +---------------------------+  +-----------------------------+  |
|                              IPC Bridge                          |
+------------------------------------------------------------------+
|  Main Process (Node.js)                                          |
|  +----------------+  +----------------+  +-------------------+   |
|  | File Watcher   |  | Timer Manager  |  | Deletion Engine   |   |
|  | - chokidar     |  | - Scheduler    |  | - Recycle Bin API |   |
|  | - Debouncing   |  | - Persistence  |  | - Lock Detection  |   |
|  +----------------+  +----------------+  +-------------------+   |
|  +----------------+  +----------------+  +-------------------+   |
|  | Tray Manager   |  | Config Store   |  | IPC Handlers      |   |
|  | - Menu         |  | - electron-    |  | - Window Mgmt     |   |
|  | - Notifications|  |   store        |  | - State Sync      |   |
|  +----------------+  +----------------+  +-------------------+   |
+------------------------------------------------------------------+
|  Native Modules / OS Integration                                 |
|  +------------------+  +------------------+  +-----------------+ |
|  | trash (npm)      |  | node-notifier    |  | Platform APIs   | |
|  | Cross-platform   |  | Native notifs    |  | Win32/Cocoa     | |
|  +------------------+  +------------------+  +-----------------+ |
+------------------------------------------------------------------+
```

### Process Model

**Main Process (Node.js runtime):**

- File system watching
- Timer scheduling and persistence
- File deletion operations
- System tray management
- Native OS integration
- Single source of truth for application state

**Renderer Process (Chromium):**

- React-based UI
- Queue visualization
- User interaction handling
- Communicates with Main via IPC

---

## Technology Stack Details

### Core Technologies

| Category     | Technology     | Version | Rationale                                |
| ------------ | -------------- | ------- | ---------------------------------------- |
| Runtime      | Electron       | ^28.0.0 | Latest stable with security patches      |
| UI Framework | React          | ^18.2.0 | Component model, hooks, mature ecosystem |
| Language     | TypeScript     | ^5.3.0  | Type safety critical for file operations |
| Build Tool   | Vite           | ^5.0.0  | Fast HMR, excellent Electron integration |
| Bundler      | Electron Forge | ^7.0.0  | Official tooling, installer generation   |

### Main Process Dependencies

| Package           | Purpose                   | Notes                         |
| ----------------- | ------------------------- | ----------------------------- |
| `chokidar`        | File system watching      | Cross-platform, battle-tested |
| `trash`           | Move files to Recycle Bin | Cross-platform trash API      |
| `electron-store`  | Persistent config storage | Encrypted option available    |
| `node-schedule`   | Timer scheduling          | Cron-like scheduling          |
| `proper-lockfile` | File lock detection       | Check if file is in use       |
| `uuid`            | Unique identifiers        | For queue item tracking       |

### Renderer Process Dependencies

| Package                 | Purpose                            | Notes                       |
| ----------------------- | ---------------------------------- | --------------------------- |
| `@tanstack/react-table` | Queue table with sorting/filtering | Headless, flexible          |
| `@radix-ui/react-*`     | Accessible UI primitives           | Dialog, dropdown, etc.      |
| `tailwindcss`           | Styling                            | Utility-first, small bundle |
| `lucide-react`          | Icons                              | Consistent, tree-shakeable  |
| `date-fns`              | Date formatting                    | Lightweight, modular        |
| `zustand`               | State management                   | Simple, minimal boilerplate |
| `react-hot-toast`       | Toast notifications                | For in-app feedback         |

### Development Dependencies

| Package                  | Purpose           |
| ------------------------ | ----------------- |
| `vitest`                 | Unit testing      |
| `@testing-library/react` | Component testing |
| `playwright`             | E2E testing       |
| `eslint` + `prettier`    | Code quality      |
| `husky` + `lint-staged`  | Pre-commit hooks  |

---

## Data Models

### Core Entities

```typescript
// Managed file in the deletion queue
interface QueueItem {
  id: string; // UUID v4
  filePath: string; // Absolute path to file
  fileName: string; // Display name
  fileSize: number; // Bytes
  fileType: string; // MIME type or extension
  addedAt: Date; // When file was detected
  scheduledDeletionAt: Date | null; // null = "Never delete"
  status: QueueItemStatus;
  clusterId?: string; // Group related downloads
  snoozedUntil?: Date; // If snoozed due to file lock
  snoozeCount: number; // Track repeated snoozes
}

type QueueItemStatus =
  | "pending" // Awaiting user decision
  | "scheduled" // Timer set, waiting for deletion
  | "snoozed" // Temporarily delayed (file in use)
  | "deleting" // Deletion in progress
  | "deleted" // Successfully moved to trash
  | "failed" // Deletion failed
  | "cancelled"; // User chose "Never" or removed

// User preferences
interface UserSettings {
  downloadsPath: string; // Folder to monitor
  launchAtStartup: boolean;
  showNotificationDialog: boolean;
  defaultTimer: TimerPreset;
  dialogPosition: "center" | "bottom-right" | "follow-cursor";
  theme: "system" | "light" | "dark";
  whitelist: WhitelistRule[];
  enableSounds: boolean;
  minimizeToTray: boolean;
  confirmBeforeDelete: boolean; // Extra confirmation for large files
  largeFileSizeThreshold: number; // Bytes, trigger confirmation
}

type TimerPreset = "5m" | "30m" | "2h" | "1d" | "never" | "ask";

interface WhitelistRule {
  id: string;
  type: "extension" | "pattern" | "folder";
  value: string; // e.g., ".exe", "*.pdf", "installers/"
  action: "never-delete" | "always-delete-after";
  timer?: TimerPreset; // If always-delete-after
  enabled: boolean;
}

// Cluster for grouping related downloads
interface DownloadCluster {
  id: string;
  items: string[]; // QueueItem IDs
  createdAt: Date;
  detectedPattern?: string; // e.g., "archive extraction"
}

// Application state
interface AppState {
  queue: QueueItem[];
  settings: UserSettings;
  clusters: DownloadCluster[];
  stats: UsageStats;
}

interface UsageStats {
  totalFilesManaged: number;
  totalSpaceReclaimed: number; // Bytes
  averageTimerChoice: TimerPreset;
  installDate: Date;
}
```

### Persistence Schema

Data stored using `electron-store` with the following structure:

```typescript
// ~/.config/tempdlm/config.json (Linux/Mac)
// %APPDATA%/tempdlm/config.json (Windows)
{
  "settings": UserSettings,
  "queue": QueueItem[],          // Active queue items
  "stats": UsageStats,
  "schemaVersion": 1             // For migrations
}
```

---

## Component Architecture

### Main Process Modules

```plain
src/
  main/
    index.ts                 # Entry point, app lifecycle
    fileWatcher.ts           # Chokidar wrapper, debouncing
    timerManager.ts          # Scheduling, persistence
    deletionEngine.ts        # Trash operations, lock detection
    trayManager.ts           # System tray icon and menu
    windowManager.ts         # Main window, dialog windows
    ipcHandlers.ts           # IPC channel definitions
    store.ts                 # electron-store wrapper
    utils/
      fileUtils.ts           # File metadata, MIME detection
      platformUtils.ts       # OS-specific helpers
```

### Renderer Components

```plain
src/
  renderer/
    App.tsx                  # Root component, routing
    components/
      Queue/
        QueueTable.tsx       # Main queue display
        QueueItem.tsx        # Individual row
        QueueFilters.tsx     # Search, sort controls
        QueueActions.tsx     # Bulk actions
      Dialog/
        NewFileDialog.tsx    # Timer selection popup
        TimerPicker.tsx      # Custom time input
        SnoozeDialog.tsx     # File-in-use handling
      Settings/
        SettingsPanel.tsx    # All user preferences
        WhitelistEditor.tsx  # Rule management
        PathPicker.tsx       # Folder selection
      Shared/
        Button.tsx
        Input.tsx
        Select.tsx
        Modal.tsx
    hooks/
      useQueue.ts            # Queue state management
      useSettings.ts         # Settings state
      useIPC.ts              # IPC communication wrapper
    stores/
      queueStore.ts          # Zustand store for queue
      settingsStore.ts       # Zustand store for settings
    styles/
      globals.css            # Tailwind imports
```

---

## IPC Communication Protocol

### Channel Definitions

```typescript
// Main -> Renderer
type MainToRenderer = {
  "file:new": (file: QueueItem) => void;
  "file:deleted": (id: string) => void;
  "file:deletion-failed": (id: string, error: string) => void;
  "file:in-use": (id: string) => void;
  "queue:updated": (queue: QueueItem[]) => void;
  "settings:updated": (settings: UserSettings) => void;
};

// Renderer -> Main
type RendererToMain = {
  "file:set-timer": (id: string, timer: TimerPreset | Date) => void;
  "file:cancel": (id: string) => void;
  "file:snooze": (id: string, duration: number) => void;
  "file:delete-now": (id: string) => void;
  "queue:get": () => QueueItem[];
  "settings:get": () => UserSettings;
  "settings:update": (settings: Partial<UserSettings>) => void;
  "window:open-main": () => void;
  "window:minimize-to-tray": () => void;
  "app:quit": () => void;
};
```

### IPC Security

```typescript
// preload.ts - Expose safe API to renderer
contextBridge.exposeInMainWorld("tempdlm", {
  // File operations
  setTimer: (id: string, timer: string | Date) =>
    ipcRenderer.invoke("file:set-timer", id, timer),
  cancelDeletion: (id: string) => ipcRenderer.invoke("file:cancel", id),

  // Event subscriptions
  onNewFile: (callback: (file: QueueItem) => void) =>
    ipcRenderer.on("file:new", (_, file) => callback(file)),

  // Settings
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (settings: Partial<UserSettings>) =>
    ipcRenderer.invoke("settings:update", settings),
});
```

---

## Core Workflows

### Workflow 1: New File Detection

```plain
1. chokidar detects new file in Downloads folder
2. fileWatcher applies debounce (500ms) for multi-file downloads
3. fileWatcher checks against whitelist rules
   - If matches "never-delete": Add to queue as 'cancelled', no dialog
   - If matches "always-delete-after": Add with preset timer, no dialog
   - Otherwise: Continue to step 4
4. Create QueueItem with status 'pending'
5. Check if clustering applies:
   - If files arrive within 2s window, group into cluster
6. Send 'file:new' IPC to renderer
7. windowManager shows NewFileDialog
   - Position based on user preference
   - Auto-focus for quick keyboard response
8. User selects timer option
9. Renderer sends 'file:set-timer' IPC
10. timerManager schedules deletion job
11. Update QueueItem status to 'scheduled'
```

### Workflow 2: Scheduled Deletion

```plain
1. node-schedule triggers deletion job
2. deletionEngine checks file existence
   - If file missing: Mark as 'deleted', update stats
3. deletionEngine checks file lock (proper-lockfile)
   - If locked: Send 'file:in-use' IPC, show SnoozeDialog
4. If unlocked:
   a. Call trash(filePath) to move to Recycle Bin
   b. On success: Update status to 'deleted', update stats
   c. On failure: Update status to 'failed', log error
5. Send 'file:deleted' or 'file:deletion-failed' IPC
6. Persist updated queue to store
```

### Workflow 3: File In Use Handling

```plain
1. Deletion attempt detects file lock
2. Create SnoozeDialog with:
   - Message: "{filename} is in use. Scheduled to delete in 2 minutes."
   - Actions: [Snooze 10 min] [Don't Delete]
3. If user clicks "Snooze 10 min":
   a. Update QueueItem.snoozedUntil = now + 10min
   b. Increment QueueItem.snoozeCount
   c. Reschedule deletion job
4. If user clicks "Don't Delete":
   a. Update QueueItem.status = 'cancelled'
   b. Remove from active queue view
5. If dialog timeout (2 min) with no action:
   a. Retry deletion
   b. If still locked, auto-snooze 10 min (up to 3 times)
   c. After 3 auto-snoozes, mark as 'failed' with clear message
```

### Workflow 4: Application Startup

```plain
1. App launches (manually or via startup)
2. Load persisted queue from electron-store
3. For each QueueItem with status 'scheduled':
   a. If scheduledDeletionAt < now:
      - Queue for immediate deletion (staggered, 500ms apart)
   b. If scheduledDeletionAt > now:
      - Re-register with timerManager
4. Initialize chokidar file watcher
5. Create system tray icon
6. If minimizeToTray setting: Stay in tray
7. If not: Open main window
```

---

## UI Specifications

### Main Window

**Dimensions:** 800x600 (default), 600x400 (minimum), resizable

**Layout:**

```plain
+----------------------------------------------------------+
|  [TempDLM]                              [_] [[ ]] [X]    |
+----------------------------------------------------------+
|  [Search: _______________]  [Sort: Delete Time v]  [+]   |
+----------------------------------------------------------+
|  | Name          | Size    | Delete At      | Actions   ||
|  |---------------------------------------------------------
|  | report.pdf    | 2.4 MB  | In 28 mins     | [E] [X]   ||
|  | setup.exe     | 156 MB  | In 1h 45m      | [E] [X]   ||
|  | image.png     | 1.2 MB  | Tomorrow 3pm   | [E] [X]   ||
|  | document.docx | 45 KB   | Never          | [E] [X]   ||
|  |                                                      ||
+----------------------------------------------------------+
|  [Settings]   4 files managed | 1.2 GB saved             |
+----------------------------------------------------------+
```

**Features:**

- Virtual scrolling for large queues (react-window)
- Inline editing of deletion time (click on time column)
- Multi-select with Shift+Click for bulk actions
- Right-click context menu
- Keyboard navigation (arrow keys, Enter to edit, Delete to remove)

### New File Dialog

**Dimensions:** 400x300 (fixed)

**Layout:**

```plain
+----------------------------------------+
|  New Download Detected                 |
+----------------------------------------+
|                                        |
|  [File Icon]  quarterly-report.pdf     |
|              2.4 MB                    |
|                                        |
|  Delete after:                         |
|                                        |
|  [ 5 min ] [ 30 min ] [ 2 hours ]      |
|  [ 1 day ] [ Never  ] [ Other... ]     |
|                                        |
|  [ ] Remember for .pdf files           |
|                                        |
+----------------------------------------+
```

**Behavior:**

- Appears near cursor or in bottom-right (configurable)
- Auto-closes after 30 seconds with default timer
- Keyboard: 1-6 keys for quick selection
- ESC to dismiss (applies default)

### System Tray Menu

```plain
TempDLM
---------
Open TempDLM
---------
Pause Monitoring (15 min)
Pause Monitoring (1 hour)
Pause Until Tomorrow
---------
4 files scheduled
---------
Settings
---------
Quit TempDLM
```

---

## Platform-Specific Considerations

### Windows (Priority 1)

| Feature       | Implementation                                                       |
| ------------- | -------------------------------------------------------------------- |
| Recycle Bin   | `trash` package uses Shell32.dll                                     |
| File watching | Native Windows events via chokidar                                   |
| Startup       | Registry key in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` |
| Notifications | Windows Toast via Electron Notification API                          |
| Installer     | NSIS via electron-builder, produces `.exe`                           |
| Code signing  | SignTool with EV certificate (recommended for trust)                 |

### macOS (Priority 2)

| Feature       | Implementation                                 |
| ------------- | ---------------------------------------------- |
| Trash         | `trash` package uses NSFileManager             |
| File watching | FSEvents via chokidar                          |
| Startup       | LaunchAgent plist in `~/Library/LaunchAgents/` |
| Notifications | macOS Notification Center                      |
| Installer     | DMG via electron-builder                       |
| Code signing  | Apple Developer ID (required for Gatekeeper)   |

### Linux (Priority 3)

| Feature       | Implementation                            |
| ------------- | ----------------------------------------- |
| Trash         | FreeDesktop.org Trash spec                |
| File watching | inotify via chokidar                      |
| Startup       | `.desktop` file in `~/.config/autostart/` |
| Notifications | libnotify                                 |
| Installer     | AppImage, .deb, .rpm via electron-builder |

---

## Security Considerations

### File System Access

- Only access user-specified Downloads folder
- No escalated privileges required
- Validate all file paths to prevent directory traversal

### Data Storage

- Config stored in platform-appropriate location
- No sensitive data (paths and preferences only)
- Optional encryption for queue data (paranoid mode)

### IPC Security

- Context isolation enabled
- Node integration disabled in renderer
- Preload script exposes minimal, validated API
- Input validation on all IPC handlers

### Update Mechanism

- Electron autoUpdater with signed releases
- Update server with HTTPS only
- User notification before applying updates

---

## Performance Requirements

| Metric                       | Target      | Measurement                  |
| ---------------------------- | ----------- | ---------------------------- |
| Startup time (to tray)       | < 2 seconds | Cold start on HDD            |
| Memory usage (idle)          | < 80 MB     | Main + renderer              |
| Memory usage (active)        | < 150 MB    | With 100 items in queue      |
| CPU usage (idle)             | < 1%        | File watcher polling         |
| CPU usage (active)           | < 5%        | During file operations       |
| File detection latency       | < 500 ms    | From file creation to dialog |
| Queue rendering (1000 items) | < 100 ms    | Full table render            |

### Optimization Strategies

- Lazy load settings panel and statistics
- Virtual scrolling for queue table
- Debounce file system events (500ms)
- Batch queue updates (100ms throttle)
- Unload dialog window when not visible

---

## Testing Strategy

### Unit Tests (Vitest)

- Timer calculations
- Whitelist pattern matching
- File metadata extraction
- Queue state transformations

### Integration Tests (Vitest + Electron)

- IPC communication
- Store persistence
- File watcher events

### E2E Tests (Playwright)

- Full user workflows
- Dialog interactions
- Settings changes
- Tray menu operations

### Manual Testing Checklist

- [ ] Install on clean Windows 10
- [ ] Install on clean Windows 11
- [ ] File detection with various browsers (Chrome, Firefox, Edge)
- [ ] Large file handling (>1GB)
- [ ] Rapid multiple downloads
- [ ] App behavior during sleep/hibernate
- [ ] Uninstall cleanup

---

## Error Handling

### File Operation Errors

| Error  | Cause                   | User Message                      | Recovery           |
| ------ | ----------------------- | --------------------------------- | ------------------ |
| ENOENT | File deleted externally | "File no longer exists"           | Remove from queue  |
| EBUSY  | File in use             | "File is in use"                  | Show snooze dialog |
| EACCES | Permission denied       | "Cannot access file"              | Log, mark failed   |
| ENOMEM | Disk full               | "Disk full, cannot move to trash" | Alert user         |

### System Errors

| Error              | Handling                                  |
| ------------------ | ----------------------------------------- |
| File watcher fails | Restart watcher, notify user if repeated  |
| Store corruption   | Backup exists, restore from backup        |
| Crash              | Auto-restart via Electron, preserve queue |

---

## Logging and Diagnostics

### Log Levels

- ERROR: File operation failures, crashes
- WARN: Retried operations, degraded states
- INFO: User actions, lifecycle events
- DEBUG: IPC messages, timer events (dev only)

### Log Storage

- Location: `%APPDATA%/tempdlm/logs/` (Windows)
- Rotation: Daily, keep 7 days
- Format: JSON lines for parsing

### Crash Reporting

- Electron crashReporter to local file
- Optional: Sentry integration for analytics (user opt-in)

---

## Distribution and Installation

### Build Configuration (electron-builder)

```yaml
appId: com.tempdlm.app
productName: TempDLM
directories:
  output: dist
files:
  - "dist/**/*"
  - "package.json"

win:
  target:
    - target: nsis
      arch: [x64, arm64]
  icon: assets/icon.ico

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  installerIcon: assets/icon.ico
  uninstallerIcon: assets/icon.ico
  createDesktopShortcut: true
  createStartMenuShortcut: true

mac:
  target:
    - target: dmg
      arch: [x64, arm64]
  icon: assets/icon.icns
  category: public.app-category.utilities

linux:
  target:
    - AppImage
    - deb
    - rpm
  icon: assets/icon.png
  category: Utility
```

### Auto-Update

```typescript
// Using electron-updater
autoUpdater.setFeedURL({
  provider: "github",
  owner: "your-username",
  repo: "tempdlm",
});

autoUpdater.checkForUpdatesAndNotify();
```

---

## Development Milestones

### Phase 1: Windows MVP (8-10 weeks)

**Week 1-2: Project Setup**

- Initialize Electron + React + TypeScript project
- Configure Vite and Electron Forge
- Set up CI/CD (GitHub Actions)
- Implement basic window and tray

**Week 3-4: Core File Watching**

- Implement chokidar file watcher
- Build file metadata extraction
- Create queue data structure
- Implement electron-store persistence

**Week 5-6: Timer and Deletion**

- Build timer scheduling system
- Implement trash operations
- Add file lock detection
- Build snooze logic

**Week 7-8: User Interface**

- Build main window with queue table
- Implement new file dialog
- Add search, sort, filter
- Build settings panel

**Week 9-10: Polish and Release**

- Implement whitelist rules
- Add startup with Windows
- Create installer
- Testing and bug fixes
- Documentation and release

### Phase 2: Enhanced Features (4-6 weeks)

- macOS support
- Download clustering
- Pattern-based whitelist
- Statistics dashboard
- Keyboard shortcuts
- Themes

### Phase 3: Extended Platform (4-6 weeks)

- Linux support
- Multiple folder monitoring
- Browser extension (optional)
- Localization
- Cloud sync preferences

---

## Appendix A: Timer Presets to Milliseconds

```typescript
const TIMER_MS: Record<TimerPreset, number | null> = {
  "5m": 5 * 60 * 1000, // 300,000
  "30m": 30 * 60 * 1000, // 1,800,000
  "2h": 2 * 60 * 60 * 1000, // 7,200,000
  "1d": 24 * 60 * 60 * 1000, // 86,400,000
  never: null, // No deletion
  ask: null, // Prompt each time (default setting)
};
```

## Appendix B: Keyboard Shortcuts

| Shortcut | Action                   |
| -------- | ------------------------ |
| `Ctrl+F` | Focus search             |
| `Ctrl+,` | Open settings            |
| `Delete` | Remove selected item(s)  |
| `Enter`  | Edit selected item timer |
| `Escape` | Close dialog/deselect    |
| `Ctrl+Q` | Quit application         |
| `Ctrl+H` | Minimize to tray         |

## Appendix C: File Type Icons

Default icons based on extension categories:

- Documents: `.pdf`, `.doc`, `.docx`, `.txt`, `.rtf`
- Images: `.jpg`, `.png`, `.gif`, `.svg`, `.webp`
- Archives: `.zip`, `.rar`, `.7z`, `.tar`, `.gz`
- Executables: `.exe`, `.msi`, `.dmg`, `.app`
- Media: `.mp3`, `.mp4`, `.avi`, `.mkv`, `.wav`
- Code: `.js`, `.py`, `.html`, `.css`, `.json`
- Other: Generic file icon

---

## Appendix D: Competitive Analysis

| Feature               | TempDLM | Belvedere (discontinued) | Hazel (macOS) | File Juggler |
| --------------------- | ------- | ------------------------ | ------------- | ------------ |
| Cross-platform        | Yes     | Windows                  | macOS         | Windows      |
| Per-file timer dialog | **Yes** | No                       | No            | No           |
| Recycle Bin           | Yes     | Yes                      | Yes           | Yes          |
| File-in-use handling  | **Yes** | No                       | Yes           | Yes          |
| System tray           | Yes     | Yes                      | Yes           | Yes          |
| Free/Open Source      | Yes     | Yes                      | No ($42)      | No ($40)     |
| Active development    | Yes     | No                       | Yes           | Yes          |

**TempDLM Differentiator:** Interactive timer selection at download time, rather than rule-based background automation.
