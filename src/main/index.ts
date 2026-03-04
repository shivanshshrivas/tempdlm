import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog } from "electron";
import path from "path";
import {
  IPC_EVENTS,
  IPC_INVOKE,
  type UserSettings,
  type SetTimerPayload,
  type CancelPayload,
  type SnoozePayload,
  type ConfirmResponsePayload,
} from "../shared/types";
import { validateSettingsPatch } from "./settingsValidator";
import {
  initStore,
  getQueue,
  getSettings,
  patchSettings,
  getQueueItem,
  removeQueueItem,
  pruneQueue,
} from "./store";
import { startWatcher, stopWatcher, setUnlinkCancelFn } from "./fileWatcher";
import {
  initDeletionEngine,
  reconcileOnStartup,
  scheduleItem,
  cancelItem,
  snoozeItem,
  cancelAllJobs,
  resolveConfirmation,
} from "./deletionEngine";
import { initUpdater, registerUpdateHandlers, stopUpdater, checkForUpdatesNow } from "./updater";
import log from "./logger";

// ─── Quit flag ────────────────────────────────────────────────────────────────

let isQuitting = false;

// ─── Dev mode ─────────────────────────────────────────────────────────────────

const isDev = !app.isPackaged;
log.info("[main] app startup", { isDev, version: app.getVersion() });

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// ─── Startup helper ───────────────────────────────────────────────────────────

function applyStartupSetting(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
  });
}

// ─── Window / tray references ─────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// ─── Tray helpers ─────────────────────────────────────────────────────────────

function buildTrayMenu(): Electron.MenuItemConstructorOptions[] {
  const queue = getQueue();
  const pendingCount = queue.filter(
    (i) => i.status === "scheduled" || i.status === "snoozed" || i.status === "pending",
  ).length;

  const label =
    pendingCount > 0
      ? `${pendingCount} file${pendingCount > 1 ? "s" : ""} pending`
      : "No files pending";

  return [
    { label: "TempDLM", enabled: false },
    { label, enabled: false },
    { type: "separator" },
    {
      label: "Open TempDLM",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: "Check for Updates",
      click: () => {
        checkForUpdatesNow();
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ];
}

function buildTrayTooltip(): string {
  const queue = getQueue();
  const pendingCount = queue.filter(
    (i) => i.status === "scheduled" || i.status === "snoozed" || i.status === "pending",
  ).length;
  return pendingCount > 0
    ? `TempDLM — ${pendingCount} file${pendingCount > 1 ? "s" : ""} pending`
    : "TempDLM";
}

function refreshTrayMenu(): void {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu()));
  tray.setToolTip(buildTrayTooltip());
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    title: "TempDLM",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox: false is required because the preload script uses ESM dynamic
      // imports (electron-store, trash) that need Node.js module resolution.
      // Mitigations in place:
      //   • contextIsolation: true  — renderer cannot access Node.js APIs
      //   • nodeIntegration: false  — renderer has no require()
      //   • All IPC inputs are validated in the main process before use
      sandbox: false,
    },
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // Hide to tray instead of closing
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // Push a fresh queue snapshot whenever the window is restored from tray,
  // so countdown timers and statuses are never stale.
  mainWindow.on("show", () => {
    mainWindow?.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
  });
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

function createTray(): void {
  const iconPath = path.join(__dirname, "../../assets/icon.ico");
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip(buildTrayTooltip());
  refreshTrayMenu();
  tray.on("click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// ─── IPC rate-limiting guard ──────────────────────────────────────────────────

// Tracks in-flight IPC operations by an opaque string key.
// Prevents the renderer from stacking up duplicate concurrent operations.
const pendingOps = new Set<string>();

function withGuard<T>(
  key: string,
  fn: () => T | Promise<T>,
): T | Promise<T> | { success: false; error: string } {
  if (pendingOps.has(key)) {
    log.warn("[main] ipc guard blocked duplicate operation", { key });
    return { success: false, error: "Operation already in progress" };
  }
  pendingOps.add(key);
  let result: T | Promise<T>;
  try {
    result = fn();
  } catch (err) {
    pendingOps.delete(key);
    log.error("[main] ipc handler threw", {
      key,
      error: getErrorMessage(err),
    });
    throw err;
  }
  if (result instanceof Promise) {
    return result
      .catch((error) => {
        log.error("[main] ipc handler rejected", {
          key,
          error: getErrorMessage(error),
        });
        throw error;
      })
      .finally(() => pendingOps.delete(key));
  }
  pendingOps.delete(key);
  return result;
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_INVOKE.QUEUE_GET, () => {
    return { success: true, data: getQueue() };
  });

  ipcMain.handle(IPC_INVOKE.SETTINGS_GET, () => {
    return { success: true, data: getSettings() };
  });

  ipcMain.handle(IPC_INVOKE.SETTINGS_UPDATE, (_e, patch: Partial<UserSettings>) => {
    return withGuard("settings:update", () => {
      const validationError = validateSettingsPatch(patch);
      if (validationError) {
        return { success: false, error: validationError };
      }

      const prev = getSettings();
      const updated = patchSettings(patch);

      // Restart watcher if the downloads folder changed
      if (mainWindow && patch.downloadsFolder && patch.downloadsFolder !== prev.downloadsFolder) {
        stopWatcher();
        startWatcher(mainWindow, updated);
      }

      if (patch.launchAtStartup !== undefined) {
        applyStartupSetting(patch.launchAtStartup);
      }

      refreshTrayMenu();
      return { success: true, data: updated };
    });
  });

  ipcMain.handle(IPC_INVOKE.FILE_SET_TIMER, (_e, payload: SetTimerPayload) => {
    return withGuard(`file:set-timer:${payload.itemId}`, () => {
      if (!mainWindow) return { success: false, error: "Window not available" };
      const item = getQueueItem(payload.itemId);
      if (!item) return { success: false, error: "Item not found" };
      scheduleItem(item, payload.minutes, mainWindow);
      mainWindow.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
      refreshTrayMenu();
      return { success: true };
    });
  });

  ipcMain.handle(IPC_INVOKE.FILE_CANCEL, (_e, payload: CancelPayload) => {
    cancelItem(payload.itemId);
    mainWindow?.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
    refreshTrayMenu();
    return { success: true };
  });

  ipcMain.handle(IPC_INVOKE.FILE_SNOOZE, (_e, payload: SnoozePayload) => {
    return withGuard(`file:snooze:${payload.itemId}`, () => {
      if (!mainWindow) return { success: false, error: "Window not available" };
      snoozeItem(payload.itemId, mainWindow);
      mainWindow.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
      refreshTrayMenu();
      return { success: true };
    });
  });

  ipcMain.handle(IPC_INVOKE.FILE_REMOVE, (_e, payload: { itemId: string }) => {
    removeQueueItem(payload.itemId);
    mainWindow?.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
    refreshTrayMenu();
    return { success: true };
  });

  ipcMain.handle(IPC_INVOKE.FILE_CONFIRM_RESPONSE, (_e, payload: ConfirmResponsePayload) => {
    resolveConfirmation(payload.itemId, payload.decision);
    return { success: true };
  });

  ipcMain.handle("dialog:pick-folder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Downloads Folder",
    });
    return { success: true, data: result.canceled ? null : result.filePaths[0] };
  });

  ipcMain.handle(IPC_INVOKE.APP_GET_VERSION, () => {
    return { success: true, data: app.getVersion() };
  });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log.warn("[main] single instance lock not acquired, quitting");
  app.quit();
} else {
  app.on("second-instance", () => {
    log.info("[main] second instance attempted; focusing existing window");
    mainWindow?.show();
    mainWindow?.focus();
  });
}

app
  .whenReady()
  .then(async () => {
    log.info("[main] app ready; initialising services");
    await initStore();
    applyStartupSetting(getSettings().launchAtStartup);
    await initDeletionEngine();

    createMainWindow();
    createTray();
    registerIpcHandlers();
    registerUpdateHandlers();

    // Start auto-update checker (only in packaged builds)
    if (!isDev && mainWindow) {
      initUpdater(mainWindow);
      log.info("[main] updater initialised");
    }

    // Wire up the unlink cancel callback to avoid circular imports
    setUnlinkCancelFn((itemId) => cancelItem(itemId));

    if (mainWindow) {
      pruneQueue(7, 500);
      reconcileOnStartup(mainWindow);
      startWatcher(mainWindow, getSettings());
      log.info("[main] startup reconciliation complete");
    }
  })
  .catch((error) => {
    log.error("[main] startup failed", { error: getErrorMessage(error) });
    app.quit();
  });

app.on("window-all-closed", () => {
  // No-op: keep app alive in tray — don't call app.quit()
});

app.on("activate", () => {
  log.info("[main] app activate event");
  mainWindow?.show();
});

app.on("before-quit", () => {
  log.info("[main] app quit requested");
  cancelAllJobs();
  stopWatcher();
  stopUpdater();
});
