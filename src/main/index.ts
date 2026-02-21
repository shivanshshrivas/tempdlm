import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog } from "electron";
import path from "path";
import {
  IPC_EVENTS,
  IPC_INVOKE,
  UserSettings,
  SetTimerPayload,
  CancelPayload,
  SnoozePayload,
  ConfirmResponsePayload,
} from "../shared/types";
import {
  initStore,
  getQueue,
  getSettings,
  patchSettings,
  getQueueItem,
  removeQueueItem,
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

// ─── Quit flag ────────────────────────────────────────────────────────────────

let isQuitting = false;

// ─── Dev mode ─────────────────────────────────────────────────────────────────

const isDev = !app.isPackaged;

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

function refreshTrayMenu(): void {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu()));
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
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

function createTray(): void {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("TempDLM");
  refreshTrayMenu();
  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_INVOKE.QUEUE_GET, () => getQueue());

  ipcMain.handle(IPC_INVOKE.SETTINGS_GET, () => getSettings());

  ipcMain.handle(IPC_INVOKE.SETTINGS_UPDATE, (_e, patch: Partial<UserSettings>) => {
    const prev = getSettings();
    const updated = patchSettings(patch);

    // Restart watcher if the downloads folder changed
    if (mainWindow && patch.downloadsFolder && patch.downloadsFolder !== prev.downloadsFolder) {
      stopWatcher();
      startWatcher(mainWindow, updated);
    }

    refreshTrayMenu();
    return updated;
  });

  ipcMain.handle(IPC_INVOKE.FILE_SET_TIMER, (_e, payload: SetTimerPayload) => {
    if (!mainWindow) return;
    const item = getQueueItem(payload.itemId);
    if (!item) return;
    scheduleItem(item, payload.minutes, mainWindow);
    mainWindow.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
    refreshTrayMenu();
  });

  ipcMain.handle(IPC_INVOKE.FILE_CANCEL, (_e, payload: CancelPayload) => {
    cancelItem(payload.itemId);
    mainWindow?.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
    refreshTrayMenu();
  });

  ipcMain.handle(IPC_INVOKE.FILE_SNOOZE, (_e, payload: SnoozePayload) => {
    if (!mainWindow) return;
    snoozeItem(payload.itemId, mainWindow);
    mainWindow.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
    refreshTrayMenu();
  });

  ipcMain.handle(IPC_INVOKE.FILE_REMOVE, (_e, payload: { itemId: string }) => {
    removeQueueItem(payload.itemId);
    mainWindow?.webContents.send(IPC_EVENTS.QUEUE_UPDATED, getQueue());
    refreshTrayMenu();
  });

  ipcMain.handle(IPC_INVOKE.FILE_CONFIRM_RESPONSE, (_e, payload: ConfirmResponsePayload) => {
    resolveConfirmation(payload.itemId, payload.decision);
  });

  ipcMain.handle("dialog:pick-folder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Downloads Folder",
    });
    return result.canceled ? null : result.filePaths[0];
  });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

app.whenReady().then(async () => {
  await initStore();
  await initDeletionEngine();

  createMainWindow();
  createTray();
  registerIpcHandlers();

  // Wire up the unlink cancel callback to avoid circular imports
  setUnlinkCancelFn((itemId) => cancelItem(itemId));

  if (mainWindow) {
    reconcileOnStartup(mainWindow);
    startWatcher(mainWindow, getSettings());
  }
});

app.on("window-all-closed", () => {
  // No-op: keep app alive in tray — don't call app.quit()
});

app.on("activate", () => {
  mainWindow?.show();
});

app.on("before-quit", () => {
  cancelAllJobs();
  stopWatcher();
});
