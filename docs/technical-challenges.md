# Technical Challenges and Solutions

This document addresses specific technical challenges identified during the specification process and provides actionable solutions.

---

## Challenge 1: "Catch Before Download" - Feasibility Analysis

### User Request

> "User interested in catching downloads BEFORE landing (needs your input on feasibility)"

### Verdict: Not Recommended for MVP

### Detailed Analysis

**Why this is technically difficult:**

1. **Browser Sandboxing**
   - Modern browsers operate in sandboxed environments
   - No external application can intercept browser's internal download process
   - Downloads are handled entirely within the browser's process space

2. **No Standard API**
   - There is no OS-level or browser-agnostic API for download interception
   - Each browser has proprietary internal download handling

3. **What Would Be Required:**

   ```plain
   Approach: Browser Extension per Browser

   Chrome/Edge (Chromium):
   - chrome.downloads.onCreated listener
   - chrome.downloads.pause() to halt
   - Native messaging to communicate with desktop app
   - Requires Chrome Web Store publishing

   Firefox:
   - browser.downloads.onCreated listener
   - Similar native messaging requirement
   - Requires Mozilla Add-ons publishing

   Safari:
   - Safari App Extensions (different architecture)
   - Requires Apple Developer account
   - macOS only
   ```

4. **Complexity vs Benefit:**
   | Factor | Browser Extension | File System Watching |
   |--------------------|------------------------------|----------------------------|
   | Development time | 3-4 weeks per browser | 1 week total |
   | Maintenance burden | High (browser updates) | Low |
   | User setup | Install app + extension | Install app only |
   | Detection speed | Instant | 200-500ms after completion |
   | Reliability | Medium (extension can break) | High |

### Recommendation

**Use file system watching.** The practical difference is negligible:

- **Small files (< 10MB):** Download completes in 1-2 seconds. Dialog appears within 500ms after. Total time nearly identical.
- **Large files (100MB+):** User won't set a 5-minute timer on a file that took 5 minutes to download. The extra 500ms is imperceptible.

**If user feedback demands pre-download interception in the future:**

- Phase 3: Build optional Chrome extension only (largest market share)
- Native messaging bridge to desktop app
- Optional installation, not required for core functionality

---

## Challenge 2: Download Clustering

### Problem

When a user extracts a ZIP file or when a single web action triggers multiple downloads, how do we avoid bombarding them with multiple dialogs?

### Solution: Time-Window Clustering

```typescript
interface ClusteringConfig {
  windowMs: number; // 2000ms default
  maxClusterSize: number; // 50 files max
  patterns: ClusterPattern[];
}

interface ClusterPattern {
  name: string;
  detector: (files: FileInfo[]) => boolean;
}

// Detection patterns
const clusterPatterns: ClusterPattern[] = [
  {
    name: "archive-extraction",
    detector: (files) => {
      // Files with same parent directory created within window
      const dirs = new Set(files.map((f) => path.dirname(f.path)));
      return dirs.size === 1 && files.length > 3;
    },
  },
  {
    name: "browser-multi-download",
    detector: (files) => {
      // Multiple files with sequential naming or from same source
      return files.every((f) => f.path.includes("(") && f.path.includes(")"));
    },
  },
];
```

### Clustering Workflow

```plain
1. File A detected at T+0ms
2. Start 2000ms cluster window
3. File B detected at T+800ms -> Add to cluster
4. File C detected at T+1500ms -> Add to cluster
5. T+2000ms window closes
6. Cluster contains [A, B, C]
7. Show SINGLE dialog:
   "3 new files detected"
   - quarterly-report.pdf (2.4 MB)
   - quarterly-data.xlsx (1.1 MB)
   - quarterly-charts.png (800 KB)

   [Set timer for all: 5m | 30m | 2h | 1d | Never]
   [Handle individually...]
```

### Edge Cases

| Scenario                   | Handling                                   |
| -------------------------- | ------------------------------------------ |
| 1 file in window           | Normal single-file dialog                  |
| 51+ files                  | Split into multiple clusters of 50         |
| User clicks "individually" | Queue separate dialogs, spaced 500ms apart |
| Mixed whitelist matches    | Remove whitelisted, cluster remainder      |

---

## Challenge 3: File Lock Detection

### Problem

Attempting to delete a file that's open in another application (e.g., PDF viewer, Word) will fail. How do we detect this proactively?

A subtler problem: some apps (e.g., Notepad) read a file into memory and **immediately release the file handle**. A handle-based lock check says "not locked", but the file is clearly in active use — deleting it while the user is editing would be destructive.

### Solution: Two-Layer Detection

**Layer 1 — Windows Restart Manager API (authoritative)**

Uses PowerShell inline C# to call the Windows Restart Manager API, which reports every process currently holding a file handle. This is the same mechanism Windows uses to show "This file is open in……" dialogs.

```csharp
// PowerShell inline C# (spawnSync, 3s timeout)
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  // ... RmGetList / RmRegisterResources P/Invoke
"@
// Returns exit code 0 = unlocked, 1 = locked
// stdout = newline-separated process names when locked
```

If locked → snooze the item (retry up to 3× at 10-minute intervals, then mark failed).

**Layer 2 — Window-Title Heuristic (catches handle-less readers)**

After Layer 1 says "not locked", run a second PowerShell command:

```powershell
Get-Process | Where-Object { $_.MainWindowTitle -like '*filename*' } |
  Select-Object -ExpandProperty Name
```

3-second timeout. Returns process names (e.g., `notepad`) whose visible window title contains the file name. **Fail-open**: any error (timeout, access denied) returns an empty list and deletion proceeds normally.

If a match is found:

1. Set item status to `confirming`
2. Send `file:confirm-delete` IPC event to renderer with the process names and a 15s timeout
3. Show `ConfirmDeleteDialog` (amber-themed, distinguishable from the blue NewFileDialog)
4. User choices:
   - **Keep file** → cancel item, return to `pending`
   - **Delete anyway** → fall through to trash
   - **Timeout (15s)** → auto-delete (user intentionally set the timer; timeout = implicit confirmation)

### Full Deletion Workflow

```plain
1. Timer expires
2. File existence check → if gone, mark deleted
3. Layer 1: Restart Manager API
   → locked: snooze (retry ≤3×, then failed)
4. Layer 2: Window-title heuristic
   → match: status = 'confirming', send IPC, await 15s
     - keep  → cancel
     - delete/timeout → continue
5. trash(filePath) → mark deleted
```

### Retry Logic

```typescript
const RETRY_CONFIG = {
  maxAutoRetries: 3,
  retryDelayMs: 10 * 60 * 1000, // 10 minutes
  finalAction: "mark-failed" as const,
};
```

After 3 snooze cycles the item is marked `failed` and stays visible in the queue for the user to handle manually.

### Confirmation Timeout Design

15 seconds was chosen as the timeout because:

- Short enough that the app doesn't feel "stuck" if the user is away
- Long enough to read the dialog and make a decision
- Defaults to **delete** (not keep) because the user explicitly scheduled the deletion; a timeout is implicit confirmation

### Status Map

| Status       | Meaning                                              |
| ------------ | ---------------------------------------------------- |
| `pending`    | Timer not yet set                                    |
| `scheduled`  | Timer running                                        |
| `snoozed`    | Layer 1 locked — waiting for retry                   |
| `confirming` | Layer 2 heuristic match — awaiting user confirmation |
| `deleting`   | Trash operation in progress                          |
| `deleted`    | Successfully moved to Recycle Bin                    |
| `failed`     | Exhausted retries or unrecoverable error             |

---

## Challenge 4: Startup Behavior and Missed Deletions

### Problem

If the app is closed when a timer expires, what happens to scheduled deletions?

### Solution: Startup Reconciliation

```typescript
async function reconcileQueueOnStartup(): Promise<void> {
  const queue = (await store.get("queue")) as QueueItem[];
  const now = Date.now();

  const toProcess: QueueItem[] = [];
  const toReschedule: QueueItem[] = [];
  const toRemove: string[] = [];

  for (const item of queue) {
    // Check if file still exists
    if (!(await fileExists(item.filePath))) {
      toRemove.push(item.id);
      continue;
    }

    if (item.status === "scheduled") {
      const scheduledTime = new Date(item.scheduledDeletionAt!).getTime();

      if (scheduledTime <= now) {
        // Timer expired while app was closed
        toProcess.push(item);
      } else {
        // Timer still in future, re-register
        toReschedule.push(item);
      }
    }
  }

  // Remove stale entries
  await Promise.all(toRemove.map((id) => removeFromQueue(id)));

  // Re-register future timers
  for (const item of toReschedule) {
    timerManager.schedule(item);
  }

  // Process overdue deletions (staggered to avoid system strain)
  for (let i = 0; i < toProcess.length; i++) {
    setTimeout(() => {
      deletionEngine.delete(toProcess[i]);
    }, i * 500); // 500ms apart
  }

  log.info(
    `Startup reconciliation: ${toProcess.length} overdue, ${toReschedule.length} rescheduled, ${toRemove.length} removed`,
  );
}
```

### Persistence Strategy

```typescript
// Save queue state on every change
async function persistQueue(queue: QueueItem[]): Promise<void> {
  await store.set("queue", queue);
  await store.set("lastSaved", Date.now());
}

// Also save on app quit
app.on("before-quit", async () => {
  await persistQueue(currentQueue);
});

// And periodically (every 60 seconds) as safety
setInterval(() => persistQueue(currentQueue), 60000);
```

---

## Challenge 5: Whitelist Implementation

### Problem

How do we provide flexible whitelist rules that are accessible to non-technical users?

### Solution: Tiered Rule System

```typescript
interface WhitelistRule {
  id: string;
  type: "extension" | "filename" | "pattern" | "folder";
  value: string;
  action: "never-delete" | "auto-delete";
  timer?: TimerPreset; // If auto-delete
  enabled: boolean;
  createdAt: Date;
}

// User-friendly presets (shown in UI)
const WHITELIST_PRESETS = [
  { label: "Installers", type: "extension", values: [".exe", ".msi", ".dmg"] },
  { label: "Documents", type: "extension", values: [".pdf", ".doc", ".docx"] },
  { label: "Archives", type: "extension", values: [".zip", ".rar", ".7z"] },
  {
    label: "Images",
    type: "extension",
    values: [".jpg", ".png", ".gif", ".svg"],
  },
];

// Matching logic
function matchesWhitelist(filePath: string, rules: WhitelistRule[]): WhitelistRule | null {
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const dir = path.dirname(filePath);

  for (const rule of rules.filter((r) => r.enabled)) {
    switch (rule.type) {
      case "extension":
        if (ext === rule.value.toLowerCase()) return rule;
        break;
      case "filename":
        if (fileName.toLowerCase() === rule.value.toLowerCase()) return rule;
        break;
      case "pattern":
        if (minimatch(fileName, rule.value, { nocase: true })) return rule;
        break;
      case "folder":
        if (dir.includes(rule.value)) return rule;
        break;
    }
  }
  return null;
}
```

### UI Design for Whitelist

```plain
+----------------------------------------------------------+
|  Whitelist Rules                                    [+]  |
+----------------------------------------------------------+
|  Quick Add:  [Installers v]  [Add]                       |
+----------------------------------------------------------+
|  | Type      | Value     | Action        | Enabled |     |
|  |-----------|-----------|---------------|---------|-----|
|  | Extension | .pdf      | Never delete  |   [x]   | [x] |
|  | Extension | .exe      | Never delete  |   [x]   | [x] |
|  | Pattern   | temp_*    | Delete: 5min  |   [x]   | [x] |
|  | Extension | .jpg      | Delete: 1day  |   [ ]   | [x] |
+----------------------------------------------------------+
|  [Add Custom Rule...]                                    |
+----------------------------------------------------------+
```

### Custom Rule Modal

```plain
+------------------------------------------+
|  Add Whitelist Rule                      |
+------------------------------------------+
|                                          |
|  Rule Type:  ( ) File Extension          |
|              ( ) File Name               |
|              (o) Pattern (wildcards)     |
|                                          |
|  Pattern:    [temp_*_______]             |
|  Example:    temp_export_123.csv         |
|                                          |
|  Action:     (o) Never delete            |
|              ( ) Auto-delete after:      |
|                  [5 minutes v]           |
|                                          |
|           [Cancel]  [Add Rule]           |
+------------------------------------------+
```

---

## Challenge 6: Multi-Monitor and Dialog Positioning

### Problem

Where should the new file dialog appear? Users have different preferences and multi-monitor setups.

### Solution: Configurable Positioning

```typescript
type DialogPosition =
  | "center" // Center of primary monitor
  | "center-active" // Center of monitor with cursor
  | "bottom-right" // Bottom-right corner of primary
  | "near-cursor" // Near current cursor position
  | "near-tray"; // Near system tray

async function getDialogBounds(position: DialogPosition): Promise<Rectangle> {
  const { screen } = require("electron");
  const cursor = screen.getCursorScreenPoint();
  const activeDisplay = screen.getDisplayNearestPoint(cursor);
  const primaryDisplay = screen.getPrimaryDisplay();

  const DIALOG_WIDTH = 400;
  const DIALOG_HEIGHT = 300;
  const MARGIN = 20;

  switch (position) {
    case "center":
      return centerOn(primaryDisplay.workArea, DIALOG_WIDTH, DIALOG_HEIGHT);

    case "center-active":
      return centerOn(activeDisplay.workArea, DIALOG_WIDTH, DIALOG_HEIGHT);

    case "bottom-right":
      return {
        x: primaryDisplay.workArea.x + primaryDisplay.workArea.width - DIALOG_WIDTH - MARGIN,
        y: primaryDisplay.workArea.y + primaryDisplay.workArea.height - DIALOG_HEIGHT - MARGIN,
        width: DIALOG_WIDTH,
        height: DIALOG_HEIGHT,
      };

    case "near-cursor":
      return positionNearPoint(cursor, activeDisplay.workArea, DIALOG_WIDTH, DIALOG_HEIGHT);

    case "near-tray":
      // Windows: bottom-right, macOS: top-right
      return getTrayPosition(primaryDisplay, DIALOG_WIDTH, DIALOG_HEIGHT);
  }
}

function centerOn(area: Rectangle, width: number, height: number): Rectangle {
  return {
    x: area.x + (area.width - width) / 2,
    y: area.y + (area.height - height) / 2,
    width,
    height,
  };
}
```

---

## Challenge 7: Performance with Large Queues

### Problem

How do we maintain UI responsiveness with 1000+ items in the queue?

### Solution: Virtualization and Pagination

```typescript
// Use react-window for virtual scrolling
import { FixedSizeList as List } from 'react-window';

function QueueTable({ items }: { items: QueueItem[] }) {
  return (
    <List
      height={600}
      itemCount={items.length}
      itemSize={48}
      width="100%"
    >
      {({ index, style }) => (
        <QueueRow
          item={items[index]}
          style={style}
          key={items[index].id}
        />
      )}
    </List>
  );
}

// Debounced search
function useSearchFilter(items: QueueItem[], query: string, delay = 200) {
  const [filtered, setFiltered] = useState(items);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (!query) {
        setFiltered(items);
      } else {
        const lower = query.toLowerCase();
        setFiltered(items.filter(item =>
          item.fileName.toLowerCase().includes(lower)
        ));
      }
    }, delay);

    return () => clearTimeout(handler);
  }, [items, query, delay]);

  return filtered;
}

// Memoized sorting
const sortedItems = useMemo(() => {
  return [...items].sort((a, b) => {
    switch (sortBy) {
      case 'delete-asc':
        return (a.scheduledDeletionAt ?? Infinity) - (b.scheduledDeletionAt ?? Infinity);
      case 'delete-desc':
        return (b.scheduledDeletionAt ?? 0) - (a.scheduledDeletionAt ?? 0);
      case 'name-asc':
        return a.fileName.localeCompare(b.fileName);
      case 'size-desc':
        return b.fileSize - a.fileSize;
      // ... etc
    }
  });
}, [items, sortBy]);
```

### IPC Optimization

```typescript
// Batch queue updates
const pendingUpdates: QueueItem[] = [];
let updateTimer: NodeJS.Timeout | null = null;

function queueUpdate(item: QueueItem) {
  pendingUpdates.push(item);

  if (!updateTimer) {
    updateTimer = setTimeout(() => {
      mainWindow.webContents.send("queue:batch-update", pendingUpdates);
      pendingUpdates.length = 0;
      updateTimer = null;
    }, 100); // Batch every 100ms
  }
}
```

---

## Challenge 8: Installer and Distribution

### Problem

How do we create a professional installer that works across Windows versions?

### Solution: Electron Builder with NSIS

```javascript
// electron-builder.config.js
module.exports = {
  appId: "com.tempdlm.app",
  productName: "TempDLM",

  win: {
    target: [
      {
        target: "nsis",
        arch: ["x64", "ia32"], // Support both 64-bit and 32-bit
      },
    ],
    icon: "build/icon.ico",
    // Code signing (optional but recommended)
    // sign: './sign.js',
    // certificateFile: process.env.WIN_CERT_FILE,
    // certificatePassword: process.env.WIN_CERT_PASSWORD,
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: "build/icon.ico",
    uninstallerIcon: "build/icon.ico",
    installerHeaderIcon: "build/icon.ico",
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "TempDLM",

    // Custom NSIS script for additional features
    include: "build/installer.nsh",
  },

  // Auto-update configuration
  publish: {
    provider: "github",
    owner: "your-username",
    repo: "tempdlm",
    releaseType: "release",
  },
};
```

### Startup Registration (Windows)

```typescript
import { app } from "electron";

function setStartupWithWindows(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true, // Start minimized to tray
    path: app.getPath("exe"),
    args: ["--startup"],
  });
}

// Check current state
function getStartupSetting(): boolean {
  return app.getLoginItemSettings().openAtLogin;
}
```

---

## Summary: Risk Mitigation Matrix

| Challenge                 | Risk Level | Solution                                         | Status           |
| ------------------------- | ---------- | ------------------------------------------------ | ---------------- |
| Pre-download interception | Low        | Defer to Phase 3, use file watching              | Deferred         |
| Download clustering       | Medium     | Time-window algorithm                            | Phase 2 planned  |
| File lock detection       | Medium     | Two-layer: Restart Manager + window-title scan   | **Implemented**  |
| Missed deletions          | Low        | Startup reconciliation                           | **Implemented**  |
| Whitelist usability       | Medium     | Extension-based (Phase 1), presets (Phase 2)     | Partial (Phase 1)|
| Dialog positioning        | Low        | Configurable positions                           | Phase 2 planned  |
| Large queue performance   | Medium     | Virtualization (react-window)                    | **Implemented**  |
| Installer distribution    | Low        | Electron Builder + NSIS                          | **Implemented**  |

All identified challenges have viable solutions. The architecture is designed to be maintainable and extensible for future requirements.
