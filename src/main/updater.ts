import { type BrowserWindow, ipcMain, shell } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import { IPC_EVENTS, IPC_INVOKE, type AppUpdateInfo, type UpdateProgress } from "../shared/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const CHECK_DELAY_MS = 10_000; // 10 seconds after startup
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000; // 6 hours

// ─── State ────────────────────────────────────────────────────────────────────

let win: BrowserWindow | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

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

export function initUpdater(mainWindow: BrowserWindow): void {
  win = mainWindow;

  // Don't auto-download — let the user decide
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // ── Events ──────────────────────────────────────────────────────────────

  autoUpdater.on("update-available", (info: UpdateInfo) => {
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
    const payload: UpdateProgress = {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    };
    win?.webContents.send(IPC_EVENTS.UPDATE_PROGRESS, payload);
  });

  autoUpdater.on("update-downloaded", () => {
    win?.webContents.send(IPC_EVENTS.UPDATE_DOWNLOADED);
  });

  autoUpdater.on("error", (err: Error) => {
    win?.webContents.send(IPC_EVENTS.UPDATE_ERROR, err.message);
  });

  // ── Scheduled checks ───────────────────────────────────────────────────

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Silently ignore — network errors, dev mode, etc.
    });
  }, CHECK_DELAY_MS);

  intervalId = setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Silently ignore
    });
  }, CHECK_INTERVAL_MS);
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

export function registerUpdateHandlers(): void {
  ipcMain.handle(IPC_INVOKE.UPDATE_CHECK, async () => {
    try {
      await autoUpdater.checkForUpdates();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_INVOKE.UPDATE_DOWNLOAD, async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_INVOKE.UPDATE_INSTALL, () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle(IPC_INVOKE.OPEN_EXTERNAL, (_e, url: string) => {
    // Allowlist: only GitHub URLs to prevent the renderer from opening arbitrary sites
    if (typeof url === "string" && url.startsWith("https://github.com/shivanshshrivas/tempdlm/")) {
      shell.openExternal(url);
    }
    return { success: true };
  });
}

// ─── Manual trigger ───────────────────────────────────────────────────────────

export function checkForUpdatesNow(): void {
  autoUpdater.checkForUpdates().catch(() => {
    // Silently ignore — network errors, dev mode, etc.
  });
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

export function stopUpdater(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  win = null;
}
