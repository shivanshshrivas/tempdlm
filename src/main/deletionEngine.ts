import fs from "fs";
import { execFile } from "child_process";
import { type BrowserWindow, Notification } from "electron";
import * as schedule from "node-schedule";
import { type QueueItem, IPC_EVENTS, type ConfirmDeletePayload } from "../shared/types";
import { getQueueItem, patchQueueItem, getQueue, getSettings } from "./store";
import log from "./logger";

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
  log.info("[deletionEngine] initialised");
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

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
 * Uses the Windows Restart Manager API via an async PowerShell/C# call —
 * this detects ALL openers regardless of their file-sharing flags, which is
 * impossible to do from pure Node.js fs calls.
 * Falls back to a rename probe if PowerShell is unavailable or times out.
 * @param filePath - Absolute path to the file to test.
 * @returns Promise resolving to true if the file is locked, false otherwise.
 */
async function isFileLocked(filePath: string): Promise<boolean> {
  // PowerShell single-quoted strings are fully literal — only single-quotes need escaping.
  // Do NOT double backslashes; doing so passes an invalid path to the Restart Manager.
  const psPath = filePath.replace(/'/g, "''");
  const script = `Add-Type -TypeDefinition '${RM_CS}'; if ([RmCheck]::CountLockers('${psPath}') -gt 0) { exit 1 } else { exit 0 }`;

  return new Promise<boolean>((resolve) => {
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 5000, windowsHide: true },
      (err) => {
        if (!err) {
          resolve(false);
          return;
        }

        // Non-zero exit code from PowerShell → file is locked (exit 1)
        if (!err.killed && typeof err.code === "number") {
          resolve(true);
          return;
        }

        // Timeout or PowerShell unavailable — fall back to rename probe
        const tmpPath = filePath + ".tdlm_lock_test";
        try {
          fs.renameSync(filePath, tmpPath);
          fs.renameSync(tmpPath, filePath);
          resolve(false);
        } catch {
          try {
            if (fs.existsSync(tmpPath)) fs.renameSync(tmpPath, filePath);
          } catch {
            /* ignore */
          }
          resolve(true);
        }
      },
    );
  });
}

// ─── Window-title heuristic (Layer 2) ────────────────────────────────────────

/**
 * Returns process names whose visible window title contains the given file name.
 * Catches editors like Notepad that load a file into memory and release the
 * file handle — the Restart Manager won't detect these.
 * Returns empty array on failure (fail-open — deletion proceeds).
 * @param fileName - The file's base name to search for in window titles.
 * @returns Promise resolving to process names (at most 32 chars each) whose titles match.
 */
async function isFileInWindowTitle(fileName: string): Promise<string[]> {
  const psName = fileName.replace(/'/g, "''");
  const script = `Get-Process | Where-Object { $_.MainWindowTitle -like '*${psName}*' } | Select-Object -ExpandProperty ProcessName -Unique`;

  return new Promise<string[]>((resolve) => {
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 3000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }

        const output = (stdout ?? "").trim();
        if (!output) {
          resolve([]);
          return;
        }

        resolve(
          output
            .split(/\r?\n/)
            .map((s) => s.trim().slice(0, 32))
            .filter(Boolean),
        );
      },
    );
  });
}

// ─── Confirmation helpers ────────────────────────────────────────────────────

/**
 * Returns a Promise that resolves when the user responds to the confirmation
 * dialog, or after the given timeout (defaulting to 'delete' since the user
 * intentionally set the timer).
 * @param itemId - The queue item ID awaiting user confirmation.
 * @param timeoutMs - Milliseconds before automatically resolving to 'delete'.
 * @returns A Promise resolving to the user's decision.
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
 * @param itemId - The queue item ID the user is responding to.
 * @param decision - Whether to proceed with deletion or keep the file.
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
 * @param itemId - The queue item ID to attempt deletion for.
 * @param win - The main BrowserWindow for sending IPC events to the renderer.
 */
async function attemptDeletion(itemId: string, win: BrowserWindow): Promise<void> {
  const item = getQueueItem(itemId);
  if (!item) return; // item was removed from store externally
  log.info("[deletionEngine] timer fired", {
    fileName: item.fileName,
    scheduledFor: item.scheduledFor,
  });
  log.debug("[deletionEngine] deletion attempt details", {
    filePath: item.filePath,
    itemId,
  });

  // 1. Check file exists
  if (!fs.existsSync(item.filePath)) {
    log.info("[deletionEngine] file already missing at deletion time", {
      fileName: item.fileName,
    });
    patchQueueItem(itemId, { status: "deleted" });
    win.webContents.send(IPC_EVENTS.FILE_DELETED, itemId);
    jobs.delete(itemId);
    return;
  }

  // 2. Check file lock
  const layer1Locked = await isFileLocked(item.filePath);
  log.info("[deletionEngine] lock check result", {
    fileName: item.fileName,
    layer: "restart-manager",
    locked: layer1Locked,
  });
  if (layer1Locked) {
    const newSnoozeCount = item.snoozeCount + 1;

    if (newSnoozeCount > MAX_SNOOZE_COUNT) {
      log.error("[deletionEngine] max snooze retries exceeded", {
        fileName: item.fileName,
        maxRetries: MAX_SNOOZE_COUNT,
      });
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
    log.warn("[deletionEngine] file locked; snoozing deletion", {
      fileName: item.fileName,
      snoozeAttempt: newSnoozeCount,
      maxRetries: MAX_SNOOZE_COUNT,
    });
    const updatedItem = getQueueItem(itemId)!;
    win.webContents.send(IPC_EVENTS.FILE_IN_USE, updatedItem);
    win.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
    showSnoozeNotification(updatedItem, win);
    scheduleJobAt(itemId, new Date(snoozedUntil), win);
    return;
  }

  // 3. Window-title heuristic — catch editors that release file handles
  const matchingProcesses = await isFileInWindowTitle(item.fileName);
  log.info("[deletionEngine] lock check result", {
    fileName: item.fileName,
    layer: "window-title",
    locked: matchingProcesses.length > 0,
    processCount: matchingProcesses.length,
  });
  if (matchingProcesses.length > 0) {
    patchQueueItem(itemId, { status: "confirming" });
    log.warn("[deletionEngine] confirm-delete initiated", {
      fileName: item.fileName,
      processCount: matchingProcesses.length,
    });

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
    log.info("[deletionEngine] confirm-delete resolved", {
      fileName: item.fileName,
      decision,
    });

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
  log.info("[deletionEngine] deleting file", { fileName: item.fileName });

  try {
    if (!_trash)
      throw new Error("deletionEngine not initialised — call initDeletionEngine() first");
    await _trash(item.filePath);

    patchQueueItem(itemId, { status: "deleted" });
    win.webContents.send(IPC_EVENTS.FILE_DELETED, itemId);
    jobs.delete(itemId);
    log.info("[deletionEngine] deletion succeeded", { fileName: item.fileName });
  } catch (err) {
    // trash() failed — likely a transient lock (e.g. file handle still open).
    // Snooze and retry rather than giving up immediately.
    const freshItem = getQueueItem(itemId);
    const newSnoozeCount = (freshItem?.snoozeCount ?? item.snoozeCount) + 1;

    if (newSnoozeCount > MAX_SNOOZE_COUNT) {
      const message = getErrorMessage(err);
      patchQueueItem(itemId, { status: "failed", error: message });
      win.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
      jobs.delete(itemId);
      log.error("[deletionEngine] deletion failed after retries", {
        fileName: item.fileName,
        error: message,
      });
    } else {
      const snoozedUntil = Date.now() + SNOOZE_MINUTES * 60 * 1000;
      patchQueueItem(itemId, {
        status: "snoozed",
        snoozeCount: newSnoozeCount,
        scheduledFor: snoozedUntil,
      });
      log.warn("[deletionEngine] transient deletion failure; snoozing", {
        fileName: item.fileName,
        snoozeAttempt: newSnoozeCount,
        error: getErrorMessage(err),
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

  const job = schedule.scheduleJob(fireAt, () => attemptDeletion(itemId, win));

  if (job) {
    jobs.set(itemId, job);
    const item = getQueueItem(itemId);
    log.info("[deletionEngine] deletion scheduled", {
      fileName: item?.fileName ?? "unknown",
      fireAt: fireAt.getTime(),
    });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Schedule a file for deletion in `minutes` from now.
 * Pass minutes=null to mark as "never delete" (status becomes "never", no job scheduled).
 * @param item - The queue item to schedule.
 * @param minutes - Minutes until deletion, or null to mark as "never delete".
 * @param win - The main BrowserWindow for sending IPC events to the renderer.
 */
export function scheduleItem(item: QueueItem, minutes: number | null, win: BrowserWindow): void {
  // Cancel any prior job for this item
  const existing = jobs.get(item.id);
  if (existing) existing.cancel();

  if (minutes === null) {
    patchQueueItem(item.id, { status: "never", scheduledFor: null });
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
 * @param itemId - The queue item ID whose scheduled deletion to cancel.
 */
export function cancelItem(itemId: string): void {
  const item = getQueueItem(itemId);
  const job = jobs.get(itemId);
  if (job) {
    job.cancel();
    jobs.delete(itemId);
  }
  resolveConfirmation(itemId, "keep");
  patchQueueItem(itemId, { status: "pending", scheduledFor: null });
  log.info("[deletionEngine] deletion cancelled", { fileName: item?.fileName ?? "unknown" });
}

/**
 * Manually snooze an item by SNOOZE_MINUTES.
 * @param itemId - The queue item ID to snooze.
 * @param win - The main BrowserWindow for sending IPC events to the renderer.
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
  log.info("[deletionEngine] manual snooze applied", {
    fileName: item.fileName,
    snoozeAttempt: newSnoozeCount,
  });

  scheduleJobAt(itemId, new Date(snoozedUntil), win);
}

/**
 * On app startup: re-register future jobs and immediately process overdue ones.
 * Overdue items are staggered 500ms apart to avoid hammering the system.
 * @param win - The main BrowserWindow for sending IPC events to the renderer.
 */
export function reconcileOnStartup(win: BrowserWindow): void {
  const queue = getQueue();
  log.info("[deletionEngine] startup reconciliation started", { queueSize: queue.length });
  const now = Date.now();
  let overdueDelay = 0;

  // One-time migration: items persisted before the "never" status was introduced
  // have status "pending" with a null scheduledFor. Promote them so they render
  // correctly with the purple "Never" badge and can be individually removed.
  for (const item of queue) {
    if (item.status === "pending" && item.scheduledFor === null) {
      patchQueueItem(item.id, { status: "never" });
    }
  }

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
  log.info("[deletionEngine] cancelling all jobs");
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
 * @returns The internal map of item IDs to their scheduled node-schedule jobs.
 */
export function _getJobs(): Map<string, schedule.Job> {
  return jobs;
}

/**
 * Exported for testing only.
 * @returns The internal map of item IDs to their pending confirmation state.
 */
export function _getPendingConfirmations(): Map<string, PendingConfirmation> {
  return pendingConfirmations;
}
