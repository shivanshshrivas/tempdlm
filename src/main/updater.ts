import { type BrowserWindow, ipcMain, shell } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import { IPC_EVENTS, IPC_INVOKE, type AppUpdateInfo, type UpdateProgress } from "../shared/types";
import log from "./logger";

// ─── Constants ────────────────────────────────────────────────────────────────

const CHECK_DELAY_MS = 10_000; // 10 seconds after startup
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000; // 6 hours

// ─── State ────────────────────────────────────────────────────────────────────

let win: BrowserWindow | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildReleaseUrl(version: string, owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}/releases/tag/v${version}`;
}

function extractReleaseNotes(info: UpdateInfo): string {
  const notes = info.releaseNotes;
  if (!notes) return "";
  if (typeof notes === "string") return notes;
  // Array of { version, note } objects
  if (Array.isArray(notes)) {
    return notes.map((n) => (typeof n === "string" ? n : (n.note ?? ""))).join("\n\n");
  }
  return "";
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialises the auto-updater, wires event listeners, and schedules periodic
 * update checks (first after CHECK_DELAY_MS, then every CHECK_INTERVAL_MS).
 * No-ops in dev mode — electron-updater skips unpacked builds automatically.
 * @param mainWindow - The main BrowserWindow to forward update events to.
 */
export function initUpdater(mainWindow: BrowserWindow): void {
  win = mainWindow;
  log.info("[updater] initialised");

  // Don't auto-download — let the user decide
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // ── Events ──────────────────────────────────────────────────────────────

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    log.info("[updater] update available", { version: info.version });
    const owner = "shivanshshrivas";
    const repo = "tempdlm";

    const payload: AppUpdateInfo = {
      version: info.version,
      releaseDate: info.releaseDate ?? new Date().toISOString(),
      releaseNotes: extractReleaseNotes(info),
      releaseNotesUrl: buildReleaseUrl(info.version, owner, repo),
    };

    win?.webContents.send(IPC_EVENTS.UPDATE_AVAILABLE, payload);
  });

  autoUpdater.on("download-progress", (progress) => {
    log.debug("[updater] download progress", {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    });
    const payload: UpdateProgress = {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    };
    win?.webContents.send(IPC_EVENTS.UPDATE_PROGRESS, payload);
  });

  autoUpdater.on("update-downloaded", () => {
    log.info("[updater] update downloaded");
    win?.webContents.send(IPC_EVENTS.UPDATE_DOWNLOADED);
  });

  autoUpdater.on("error", (err: Error) => {
    log.error("[updater] updater error", { error: err.message });
    win?.webContents.send(IPC_EVENTS.UPDATE_ERROR, err.message);
  });

  // ── Scheduled checks ───────────────────────────────────────────────────

  setTimeout(() => {
    log.info("[updater] scheduled update check triggered");
    autoUpdater.checkForUpdates().catch(() => {
      log.warn("[updater] scheduled update check failed");
    });
  }, CHECK_DELAY_MS);

  intervalId = setInterval(() => {
    log.info("[updater] periodic update check triggered");
    autoUpdater.checkForUpdates().catch(() => {
      log.warn("[updater] periodic update check failed");
    });
  }, CHECK_INTERVAL_MS);
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

/**
 * Registers IPC handlers for update-related renderer invocations:
 * check, download, install, and shell:open-external (GitHub-allowlisted).
 */
export function registerUpdateHandlers(): void {
  ipcMain.handle(IPC_INVOKE.UPDATE_CHECK, async () => {
    log.info("[updater] manual update check requested");
    try {
      await autoUpdater.checkForUpdates();
      log.info("[updater] manual update check completed");
      return { success: true };
    } catch (err) {
      const message = getErrorMessage(err);
      log.warn("[updater] manual update check failed", { error: message });
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_INVOKE.UPDATE_DOWNLOAD, async () => {
    log.info("[updater] update download requested");
    try {
      await autoUpdater.downloadUpdate();
      log.info("[updater] update download started");
      return { success: true };
    } catch (err) {
      const message = getErrorMessage(err);
      log.error("[updater] update download failed", { error: message });
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_INVOKE.UPDATE_INSTALL, () => {
    log.info("[updater] update install triggered");
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle(IPC_INVOKE.OPEN_EXTERNAL, (_e, url: string) => {
    // Allowlist: only GitHub URLs to prevent the renderer from opening arbitrary sites
    if (typeof url === "string" && url.startsWith("https://github.com/shivanshshrivas/tempdlm/")) {
      log.info("[updater] opening external GitHub URL");
      shell.openExternal(url);
    } else {
      log.warn("[updater] blocked non-allowlisted external URL");
    }
    return { success: true };
  });
}

// ─── Manual trigger ───────────────────────────────────────────────────────────

/**
 * Triggers an immediate update check and logs recoverable failures as warnings.
 * Safe to call from the tray menu at any time.
 */
export function checkForUpdatesNow(): void {
  log.info("[updater] tray update check triggered");
  autoUpdater.checkForUpdates().catch(() => {
    log.warn("[updater] tray update check failed");
  });
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Cancels the periodic update check interval and releases the window reference.
 * Call on app quit to prevent dangling timers.
 */
export function stopUpdater(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  win = null;
  log.info("[updater] stopped");
}
