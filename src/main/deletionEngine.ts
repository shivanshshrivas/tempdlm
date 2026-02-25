import fs from "fs";
import { spawnSync } from "child_process";
import { BrowserWindow, Notification } from "electron";
import * as schedule from "node-schedule";
import { QueueItem, IPC_EVENTS, ConfirmDeletePayload } from "../shared/types";
import { getQueueItem, patchQueueItem, getQueue, getSettings } from "./store";

// trash is ESM-only. We load it once at startup via initDeletionEngine()
// and hold a reference here so vi.mock('trash') can intercept it in tests.
type TrashFn = (path: string) => Promise<void>;
let _trash: TrashFn | null = null;

/**
 * Must be called once after app.whenReady() before any deletions are attempted.
 */
export async function initDeletionEngine(): Promise<void> {
  const mod = await import("trash");
  _trash = mod.default as TrashFn;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SNOOZE_MINUTES = 10;
const MAX_SNOOZE_COUNT = 3;
const CONFIRM_TIMEOUT_MS = 15_000;

// ─── Internal state ───────────────────────────────────────────────────────────

// Maps itemId → scheduled job
const jobs = new Map<string, schedule.Job>();

// Keeps active Notification instances alive until clicked/closed so GC doesn't
// destroy the click listener before the user interacts with the notification.
const activeNotifications = new Set<Electron.Notification>();

// Maps itemId → pending confirmation resolver
interface PendingConfirmation {
  resolve: (decision: "delete" | "keep") => void;
  timer: ReturnType<typeof setTimeout>;
}
const pendingConfirmations = new Map<string, PendingConfirmation>();

// ─── File lock detection ──────────────────────────────────────────────────────

// Inline C# for the Windows Restart Manager API (rstrtmgr.dll).
// Restart Manager enumerates ALL processes that have a file open, regardless
// of the sharing flags those processes used — this is the same mechanism
// Windows Update uses to find "files in use" before installing updates.
// Single-quoted so it can be embedded in a PowerShell -Command string.
const RM_CS = [
  "using System;",
  "using System.Runtime.InteropServices;",
  "public class RmCheck {",
  '  [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] static extern int RmStartSession(out uint h,int f,string k);',
  '  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint h);',
  '  [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] static extern int RmRegisterResources(uint h,uint n,string[] f,uint na,IntPtr a,uint ns,string[] s);',
  '  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint h,out uint needed,ref uint count,IntPtr apps,ref uint r);',
  "  public static int CountLockers(string p){",
  "    uint h; RmStartSession(out h,0,Guid.NewGuid().ToString());",
  "    try{ RmRegisterResources(h,1,new[]{p},0,IntPtr.Zero,0,null); uint n=0,c=0,r=0; RmGetList(h,out n,ref c,IntPtr.Zero,ref r); return(int)n; }",
  "    finally{ RmEndSession(h); }",
  "  }",
  "}",
].join(" ");

/**
 * Returns true if any process currently has the file open.
 * Uses the Windows Restart Manager API via an inline PowerShell/C# call —
 * this detects ALL openers regardless of their file-sharing flags, which is
 * impossible to do from pure Node.js fs calls.
 * Falls back to a rename probe if PowerShell is unavailable.
 */
function isFileLocked(filePath: string): boolean {
  // PowerShell single-quoted strings are fully literal — only single-quotes need escaping.
  // Do NOT double backslashes; doing so passes an invalid path to the Restart Manager.
  const psPath = filePath.replace(/'/g, "''");
  const script = `Add-Type -TypeDefinition '${RM_CS}'; if ([RmCheck]::CountLockers('${psPath}') -gt 0) { exit 1 } else { exit 0 }`;

  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    timeout: 5000,
    windowsHide: true,
  });

  if (result.error) {
    // PowerShell unavailable — fall back to rename probe
    const tmpPath = filePath + ".tdlm_lock_test";
    try {
      fs.renameSync(filePath, tmpPath);
      fs.renameSync(tmpPath, filePath);
      return false;
    } catch {
      try {
        if (fs.existsSync(tmpPath)) fs.renameSync(tmpPath, filePath);
      } catch {
        /* ignore */
      }
      return true;
    }
  }

  return result.status !== 0;
}

// ─── Window-title heuristic (Layer 2) ────────────────────────────────────────

/**
 * Returns process names whose visible window title contains the given file name.
 * Catches editors like Notepad that load a file into memory and release the
 * file handle — the Restart Manager won't detect these.
 * Returns empty array on failure (fail-open — deletion proceeds).
 */
function isFileInWindowTitle(fileName: string): string[] {
  const psName = fileName.replace(/'/g, "''");
  const script = `Get-Process | Where-Object { $_.MainWindowTitle -like '*${psName}*' } | Select-Object -ExpandProperty ProcessName -Unique`;

  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    timeout: 3000,
    windowsHide: true,
  });

  if (result.error || result.status !== 0) {
    return [];
  }

  const output = result.stdout?.toString().trim() ?? "";
  if (!output) return [];

  return output
    .split(/\r?\n/)
    .map((s) => s.trim().slice(0, 32))
    .filter(Boolean);
}

// ─── Confirmation helpers ────────────────────────────────────────────────────

/**
 * Returns a Promise that resolves when the user responds to the confirmation
 * dialog, or after CONFIRM_TIMEOUT_MS (defaulting to 'delete' since the user
 * intentionally set the timer).
 */
function waitForConfirmation(itemId: string, timeoutMs: number): Promise<"delete" | "keep"> {
  return new Promise<"delete" | "keep">((resolve) => {
    const timer = setTimeout(() => {
      pendingConfirmations.delete(itemId);
      resolve("delete");
    }, timeoutMs);

    pendingConfirmations.set(itemId, { resolve, timer });
  });
}

/**
 * Called by the IPC handler when the user responds to a confirmation dialog.
 */
export function resolveConfirmation(itemId: string, decision: "delete" | "keep"): void {
  const pending = pendingConfirmations.get(itemId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingConfirmations.delete(itemId);
  pending.resolve(decision);
}

// ─── Notification helpers ─────────────────────────────────────────────────────

function showSnoozeNotification(item: QueueItem, win: BrowserWindow): void {
  const settings = getSettings();
  if (!settings.showNotifications) return;
  if (!Notification.isSupported()) return;
  if (win.isVisible()) return;

  const n = new Notification({
    title: "TempDLM — File in use",
    body: `${item.fileName} is open. Deletion rescheduled for ${SNOOZE_MINUTES} minutes.`,
  });
  activeNotifications.add(n);
  n.on("click", () => {
    activeNotifications.delete(n);
    win.show();
    win.focus();
  });
  n.show();
}

function showConfirmDeleteNotification(item: QueueItem, processNames: string[]): void {
  const settings = getSettings();
  if (!settings.showNotifications) return;
  if (!Notification.isSupported()) return;

  const appList = processNames.slice(0, 2).join(", ");
  const n = new Notification({
    title: "TempDLM — File may be open",
    body: `${item.fileName} appears open in ${appList}.`,
    silent: true, // renderer plays its own chime
  });
  n.show();
}

// ─── Deletion attempt ─────────────────────────────────────────────────────────

/**
 * Core deletion attempt. Called when a job fires.
 * Handles ENOENT, lock detection, snooze logic, and the actual trash call.
 */
async function attemptDeletion(itemId: string, win: BrowserWindow): Promise<void> {
  const item = getQueueItem(itemId);
  if (!item) return; // item was removed from store externally

  // 1. Check file exists
  if (!fs.existsSync(item.filePath)) {
    patchQueueItem(itemId, { status: "deleted" });
    win.webContents.send(IPC_EVENTS.FILE_DELETED, itemId);
    jobs.delete(itemId);
    return;
  }

  // 2. Check file lock
  if (isFileLocked(item.filePath)) {
    const newSnoozeCount = item.snoozeCount + 1;

    if (newSnoozeCount > MAX_SNOOZE_COUNT) {
      // Give up — mark as failed
      patchQueueItem(itemId, {
        status: "failed",
        error: "File remained locked after max retries",
      });
      win.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
      jobs.delete(itemId);
      return;
    }

    // Snooze: reschedule for SNOOZE_MINUTES from now
    const snoozedUntil = Date.now() + SNOOZE_MINUTES * 60 * 1000;
    patchQueueItem(itemId, {
      status: "snoozed",
      snoozeCount: newSnoozeCount,
      scheduledFor: snoozedUntil,
    });
    const updatedItem = getQueueItem(itemId)!;
    win.webContents.send(IPC_EVENTS.FILE_IN_USE, updatedItem);
    win.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
    showSnoozeNotification(updatedItem, win);
    scheduleJobAt(itemId, new Date(snoozedUntil), win);
    return;
  }

  // 3. Window-title heuristic — catch editors that release file handles
  const matchingProcesses = isFileInWindowTitle(item.fileName);
  if (matchingProcesses.length > 0) {
    patchQueueItem(itemId, { status: "confirming" });

    // Always bring the window to the foreground so the user sees the
    // confirmation dialog immediately — this is time-sensitive.
    if (!win.isVisible()) {
      win.show();
      win.focus();
    }

    // Cap process names: show at most 3, each truncated to 32 chars (already
    // done by isFileInWindowTitle), and append "…and N more" if there are extras.
    const MAX_DISPLAY_PROCS = 3;
    const displayedProcesses = matchingProcesses.slice(0, MAX_DISPLAY_PROCS);
    const extraCount = matchingProcesses.length - displayedProcesses.length;
    const processNamesForDialog =
      extraCount > 0 ? [...displayedProcesses, `…and ${extraCount} more`] : displayedProcesses;

    const confirmPayload: ConfirmDeletePayload = {
      item: getQueueItem(itemId)!,
      processNames: processNamesForDialog,
      timeoutMs: CONFIRM_TIMEOUT_MS,
      confirmationStartedAt: Date.now(),
    };
    win.webContents.send(IPC_EVENTS.FILE_CONFIRM_DELETE, confirmPayload);
    win.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
    showConfirmDeleteNotification(confirmPayload.item, displayedProcesses);

    const decision = await waitForConfirmation(itemId, CONFIRM_TIMEOUT_MS);

    if (decision === "keep") {
      patchQueueItem(itemId, { status: "pending", scheduledFor: null });
      win.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
      jobs.delete(itemId);
      return;
    }
    // decision === 'delete' → fall through to trash
  }

  // 4. Trash the file
  patchQueueItem(itemId, { status: "deleting" });
  win.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());

  try {
    if (!_trash)
      throw new Error("deletionEngine not initialised — call initDeletionEngine() first");
    await _trash(item.filePath);

    patchQueueItem(itemId, { status: "deleted" });
    win.webContents.send(IPC_EVENTS.FILE_DELETED, itemId);
    jobs.delete(itemId);
  } catch (err) {
    // trash() failed — likely a transient lock (e.g. file handle still open).
    // Snooze and retry rather than giving up immediately.
    const freshItem = getQueueItem(itemId);
    const newSnoozeCount = (freshItem?.snoozeCount ?? item.snoozeCount) + 1;

    if (newSnoozeCount > MAX_SNOOZE_COUNT) {
      const message = err instanceof Error ? err.message : String(err);
      patchQueueItem(itemId, { status: "failed", error: message });
      win.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
      jobs.delete(itemId);
    } else {
      const snoozedUntil = Date.now() + SNOOZE_MINUTES * 60 * 1000;
      patchQueueItem(itemId, {
        status: "snoozed",
        snoozeCount: newSnoozeCount,
        scheduledFor: snoozedUntil,
      });
      const updatedItem = getQueueItem(itemId)!;
      win.webContents.send(IPC_EVENTS.FILE_IN_USE, updatedItem);
      win.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
      showSnoozeNotification(updatedItem, win);
      scheduleJobAt(itemId, new Date(snoozedUntil), win);
    }
  }
}

// ─── Internal scheduler ───────────────────────────────────────────────────────

function scheduleJobAt(itemId: string, fireAt: Date, win: BrowserWindow): void {
  // Cancel any existing job for this item
  const existing = jobs.get(itemId);
  if (existing) existing.cancel();

  const job = schedule.scheduleJob(fireAt, () => {
    attemptDeletion(itemId, win);
  });

  if (job) {
    jobs.set(itemId, job);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Schedule a file for deletion in `minutes` from now.
 * Pass minutes=null to mark as "never delete" (status stays pending, no job).
 */
export function scheduleItem(item: QueueItem, minutes: number | null, win: BrowserWindow): void {
  // Cancel any prior job for this item
  const existing = jobs.get(item.id);
  if (existing) existing.cancel();

  if (minutes === null) {
    patchQueueItem(item.id, { status: "pending", scheduledFor: null });
    return;
  }

  const fireAt = new Date(Date.now() + minutes * 60 * 1000);
  patchQueueItem(item.id, {
    status: "scheduled",
    scheduledFor: fireAt.getTime(),
  });
  scheduleJobAt(item.id, fireAt, win);
}

/**
 * Cancel a scheduled deletion. Item remains in queue as pending.
 */
export function cancelItem(itemId: string): void {
  const job = jobs.get(itemId);
  if (job) {
    job.cancel();
    jobs.delete(itemId);
  }
  resolveConfirmation(itemId, "keep");
  patchQueueItem(itemId, { status: "pending", scheduledFor: null });
}

/**
 * Manually snooze an item by SNOOZE_MINUTES.
 */
export function snoozeItem(itemId: string, win: BrowserWindow): void {
  const item = getQueueItem(itemId);
  if (!item) return;

  // Extend from the current scheduledFor time (or now if already past) so that
  // snoozing a 30-min timer gives 40 min remaining, not a reset to 10 min.
  const base = item.scheduledFor && item.scheduledFor > Date.now() ? item.scheduledFor : Date.now();
  const snoozedUntil = base + SNOOZE_MINUTES * 60 * 1000;
  const newSnoozeCount = item.snoozeCount + 1;

  patchQueueItem(itemId, {
    status: "snoozed",
    snoozeCount: newSnoozeCount,
    scheduledFor: snoozedUntil,
  });

  scheduleJobAt(itemId, new Date(snoozedUntil), win);
}

/**
 * On app startup: re-register future jobs and immediately process overdue ones.
 * Overdue items are staggered 500ms apart to avoid hammering the system.
 */
export function reconcileOnStartup(win: BrowserWindow): void {
  const queue = getQueue();
  const now = Date.now();
  let overdueDelay = 0;

  for (const item of queue) {
    if (item.status === "deleted" || item.status === "failed" || item.status === "whitelisted") {
      continue;
    }

    if (item.scheduledFor === null) {
      continue; // "Never delete" — no job needed
    }

    if (item.scheduledFor > now) {
      // Future — re-register job
      scheduleJobAt(item.id, new Date(item.scheduledFor), win);
    } else {
      // Overdue — process with stagger
      const delay = overdueDelay;
      setTimeout(() => attemptDeletion(item.id, win), delay);
      overdueDelay += 500;
    }
  }
}

/**
 * Cancel all active jobs. Call on app quit.
 */
export function cancelAllJobs(): void {
  for (const job of jobs.values()) {
    job.cancel();
  }
  jobs.clear();

  for (const [, pending] of pendingConfirmations) {
    clearTimeout(pending.timer);
    pending.resolve("keep");
  }
  pendingConfirmations.clear();
}

/**
 * Exported for testing only.
 */
export function _getJobs(): Map<string, schedule.Job> {
  return jobs;
}

/**
 * Exported for testing only.
 */
export function _getPendingConfirmations(): Map<string, PendingConfirmation> {
  return pendingConfirmations;
}
