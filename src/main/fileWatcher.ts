import fs from "fs";
import path from "path";

// Always use win32 path parsing — this app runs on Windows and receives
// Windows-style paths. Using path.win32 ensures tests on Linux also parse
// backslash-separated paths correctly.
const winPath = path.win32;
import { type BrowserWindow, Notification } from "electron";
import chokidar, { type FSWatcher } from "chokidar";
import { randomUUID } from "crypto";
import { type QueueItem, type UserSettings, type WhitelistRule, IPC_EVENTS } from "../shared/types";
import { upsertQueueItem, getSettings, getQueue, patchQueueItem } from "./store";

// ─── Internal state ───────────────────────────────────────────────────────────

let watcher: FSWatcher | null = null;

// Debounce timers keyed by absolute file path
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

const DEBOUNCE_MS = 500;

// Rename detection: when a file is unlinked, we keep its inode → itemId mapping
// for a short window. If an 'add' arrives within that window with the same inode,
// it's a rename — we patch the existing item rather than creating a new one.
const RENAME_WINDOW_MS = 3000;
const recentlyUnlinkedByInode = new Map<
  number,
  { itemId: string; timer: ReturnType<typeof setTimeout> }
>();

// Callback set by main to cancel a scheduled job when a file is unlinked.
// Avoids circular import between fileWatcher <-> deletionEngine.
let _cancelJobFn: ((itemId: string) => void) | null = null;

/**
 * Registers the callback that cancels a deletion job when a file is unlinked.
 * Called once by the main process to wire fileWatcher ↔ deletionEngine
 * without creating a circular import between the two modules.
 * @param fn - Callback that receives the queue item ID whose job to cancel.
 */
export function setUnlinkCancelFn(fn: (itemId: string) => void): void {
  _cancelJobFn = fn;
}

// ─── Whitelist matching ───────────────────────────────────────────────────────

/**
 * Returns the matching whitelist rule for a given file, or null if none match.
 * Phase 1: extension-based and exact-filename rules only.
 * @param fileName - The base file name to match against (e.g. "report.pdf").
 * @param rules - The whitelist rules to evaluate, in priority order.
 * @returns The first matching enabled WhitelistRule, or null if none match.
 */
export function matchWhitelistRule(fileName: string, rules: WhitelistRule[]): WhitelistRule | null {
  const ext = winPath.extname(fileName).toLowerCase();
  const base = winPath.basename(fileName).toLowerCase();

  for (const rule of rules) {
    if (!rule.enabled) continue;

    if (rule.type === "extension" && ext === rule.value.toLowerCase()) {
      return rule;
    }
    if (rule.type === "filename" && base === rule.value.toLowerCase()) {
      return rule;
    }
  }
  return null;
}

// ─── QueueItem builder ────────────────────────────────────────────────────────

/**
 * Builds a QueueItem from a file path. Returns null if stat fails (file gone).
 * @param filePath - Absolute path to the newly detected file.
 * @returns A populated QueueItem ready for insertion, or null if the file vanished.
 */
export function buildQueueItem(filePath: string): QueueItem | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }

  const fileName = winPath.basename(filePath);
  const fileExtension = winPath.extname(fileName).toLowerCase();

  return {
    id: randomUUID(),
    filePath,
    fileName,
    fileSize: stat.size,
    fileExtension,
    inode: stat.ino,
    detectedAt: Date.now(),
    scheduledFor: null,
    status: "pending",
    snoozeCount: 0,
    clusterId: null,
  };
}

// ─── Core handlers ────────────────────────────────────────────────────────────

/**
 * Called when chokidar reports a content change on a tracked file.
 * Re-stats the file and updates the queue item's fileSize if it has changed,
 * then notifies the renderer so the displayed size stays accurate for files
 * that are still growing after initial detection (e.g. large active downloads).
 * @param filePath - Absolute path to the changed file.
 * @param win - The main BrowserWindow for sending IPC events to the renderer.
 */
function handleFileChanged(filePath: string, win: BrowserWindow): void {
  const item = getQueue().find(
    (i) => i.filePath === filePath && i.status !== "deleted" && i.status !== "failed",
  );
  if (!item) return;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return; // file may have been deleted between the change event and our stat
  }

  if (stat.size === item.fileSize) return; // no change — skip unnecessary IPC

  patchQueueItem(item.id, { fileSize: stat.size });
  win.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
}

/**
 * Called after debounce for each newly detected file.
 * If the file's inode matches a recently unlinked item, it's a rename:
 * patch the existing item in-place (preserving timer) instead of creating a new entry.
 * @param filePath - Absolute path to the detected file.
 * @param win - The main BrowserWindow for sending IPC events to the renderer.
 */
function handleNewFile(filePath: string, win: BrowserWindow): void {
  // Skip if this exact path is already tracked as an active item
  const existingByPath = getQueue().find(
    (i) => i.filePath === filePath && i.status !== "deleted" && i.status !== "failed",
  );
  if (existingByPath) return;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return; // file disappeared before we could stat it
  }

  // ── Rename detection ────────────────────────────────────────────────────────
  // If we saw this inode get unlinked recently, it's a rename not a new file.
  const renameEntry = recentlyUnlinkedByInode.get(stat.ino);
  if (renameEntry) {
    clearTimeout(renameEntry.timer);
    recentlyUnlinkedByInode.delete(stat.ino);

    const fileName = winPath.basename(filePath);
    const fileExtension = winPath.extname(fileName).toLowerCase();

    // Patch the existing item with the new path/name, keep everything else
    patchQueueItem(renameEntry.itemId, {
      filePath,
      fileName,
      fileExtension,
      fileSize: stat.size,
    });
    win.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
    return;
  }

  // ── New file ─────────────────────────────────────────────────────────────
  const fileName = winPath.basename(filePath);
  const fileExtension = winPath.extname(fileName).toLowerCase();

  const item: QueueItem = {
    id: randomUUID(),
    filePath,
    fileName,
    fileSize: stat.size,
    fileExtension,
    inode: stat.ino,
    detectedAt: Date.now(),
    scheduledFor: null,
    status: "pending",
    snoozeCount: 0,
    clusterId: null,
  };

  const settings = getSettings();
  const rule = matchWhitelistRule(item.fileName, settings.whitelistRules);

  if (rule) {
    if (rule.action === "never-delete") {
      item.status = "whitelisted";
      upsertQueueItem(item);
      win.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
      return;
    }

    if (rule.action === "auto-delete-after" && rule.autoDeleteMinutes != null) {
      item.status = "scheduled";
      item.scheduledFor = Date.now() + rule.autoDeleteMinutes * 60 * 1000;
      upsertQueueItem(item);
      win.webContents.send(IPC_EVENTS.FILE_NEW, item);
      return;
    }
  }

  // Normal path: persist as pending, send to renderer for dialog
  upsertQueueItem(item);
  win.webContents.send(IPC_EVENTS.FILE_NEW, item);

  // Show native toast if enabled
  if (settings.showNotifications && Notification.isSupported()) {
    const n = new Notification({
      title: "TempDLM — New file detected",
      body: item.fileName,
      silent: true, // renderer plays its own chime
    });
    n.on("click", () => {
      win.show();
      win.focus();
    });
    n.show();
  }

  // Always surface the window so the dialog is visible
  if (!win.isVisible()) win.show();
}

/**
 * Called when chokidar detects a file removal (manual delete or rename-away).
 * Records the inode in a short-lived map so handleNewFile can detect renames.
 * If no matching 'add' arrives within RENAME_WINDOW_MS, treats as a true delete.
 * @param filePath - Absolute path to the removed file.
 * @param win - The main BrowserWindow for sending IPC events to the renderer.
 */
function handleFileUnlinked(filePath: string, win: BrowserWindow): void {
  // Cancel any pending debounce for this path (rapid create-then-delete)
  const pending = debounceTimers.get(filePath);
  if (pending) {
    clearTimeout(pending);
    debounceTimers.delete(filePath);
  }

  const item = getQueue().find(
    (i) => i.filePath === filePath && i.status !== "deleted" && i.status !== "failed",
  );
  if (!item) return;

  // Record the inode for rename detection. If a matching 'add' arrives within
  // the rename window, handleNewFile will patch the item instead of deleting it.
  const expireTimer = setTimeout(() => {
    recentlyUnlinkedByInode.delete(item.inode);
    // No matching 'add' arrived — this is a true delete
    if (_cancelJobFn) _cancelJobFn(item.id);
    patchQueueItem(item.id, { status: "deleted", scheduledFor: null });
    win.webContents.send(IPC_EVENTS.FILE_DELETED, item.id);
  }, RENAME_WINDOW_MS);

  recentlyUnlinkedByInode.set(item.inode, {
    itemId: item.id,
    timer: expireTimer,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start watching the downloads folder. Safe to call multiple times — stops
 * the previous watcher first.
 * @param win - The main BrowserWindow for sending IPC events to the renderer.
 * @param settings - Current user settings supplying the folder path to watch.
 */
export function startWatcher(win: BrowserWindow, settings: UserSettings): void {
  stopWatcher();

  watcher = chokidar.watch(settings.downloadsFolder, {
    depth: 0,
    ignored: /(^|[/\\])\../,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100,
    },
    ignoreInitial: true,
    persistent: true,
  });

  watcher.on("add", (filePath: string) => {
    const existing = debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      debounceTimers.delete(filePath);
      handleNewFile(filePath, win);
    }, DEBOUNCE_MS);

    debounceTimers.set(filePath, timer);
  });

  watcher.on("unlink", (filePath: string) => {
    handleFileUnlinked(filePath, win);
  });

  watcher.on("change", (filePath: string) => {
    handleFileChanged(filePath, win);
  });

  watcher.on("error", (error: unknown) => {
    console.error("[fileWatcher] error:", error);
  });
}

/**
 * Stop the active watcher and clear all pending debounce timers.
 */
export function stopWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
  for (const entry of recentlyUnlinkedByInode.values()) {
    clearTimeout(entry.timer);
  }
  recentlyUnlinkedByInode.clear();
}

/**
 * Exported for testing only — lets tests inspect active debounce timers.
 * @returns The internal map of file paths to their pending debounce timer handles.
 */
export function _getDebounceTimers(): Map<string, ReturnType<typeof setTimeout>> {
  return debounceTimers;
}
