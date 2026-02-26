import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog } from "electron";
import path from "path";
import fs from "fs";
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
import { initUpdater, registerUpdateHandlers, stopUpdater, checkForUpdatesNow } from "./updater";

// ─── Quit flag ────────────────────────────────────────────────────────────────

let isQuitting = false;

// ─── Dev mode ─────────────────────────────────────────────────────────────────

const isDev = !app.isPackaged;

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

// ─── Settings validation ──────────────────────────────────────────────────────

// Reject paths under these system roots to prevent watching/deleting system files.
const BLOCKED_PATH_PREFIXES = [
  "C:\\Windows",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
  "C:\\ProgramData",
];

/**
 * Validates a Partial<UserSettings> payload received from the renderer.
 * Returns null if valid, or an error string describing the first violation.
 */
function validateSettingsPatch(patch: Partial<UserSettings>): string | null {
  if (patch.downloadsFolder !== undefined) {
    const raw = patch.downloadsFolder;
    if (typeof raw !== "string" || raw.trim() === "") {
      return "downloadsFolder must be a non-empty string";
    }
    if (!path.isAbsolute(raw)) {
      return "downloadsFolder must be an absolute path";
    }
    let resolved: string;
    try {
      resolved = fs.realpathSync(raw);
    } catch {
      return "downloadsFolder does not exist or is not accessible";
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return "downloadsFolder does not exist";
    }
    if (!stat.isDirectory()) {
      return "downloadsFolder must be a directory";
    }
    const upper = resolved.toUpperCase();
    for (const prefix of BLOCKED_PATH_PREFIXES) {
      if (upper.startsWith(prefix.toUpperCase())) {
        return `downloadsFolder may not be a system path (${prefix})`;
      }
    }
    // Write the resolved (symlink-free) path back so the rest of the app uses
    // the canonical path.
    patch.downloadsFolder = resolved;
  }

  if (patch.customDefaultMinutes !== undefined) {
    const v = patch.customDefaultMinutes;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 40320) {
      return "customDefaultMinutes must be an integer between 1 and 40320";
    }
  }

  if (patch.defaultTimer !== undefined) {
    const allowed = ["5m", "30m", "2h", "1d", "never", "custom"] as const;
    if (!allowed.includes(patch.defaultTimer as (typeof allowed)[number])) {
      return `defaultTimer must be one of: ${allowed.join(", ")}`;
    }
  }

  if (patch.dialogPosition !== undefined) {
    const allowed = ["center", "bottom-right", "near-tray"] as const;
    if (!allowed.includes(patch.dialogPosition as (typeof allowed)[number])) {
      return `dialogPosition must be one of: ${allowed.join(", ")}`;
    }
  }

  if (patch.theme !== undefined) {
    const allowed = ["system", "light", "dark"] as const;
    if (!allowed.includes(patch.theme as (typeof allowed)[number])) {
      return `theme must be one of: ${allowed.join(", ")}`;
    }
  }

  if (patch.launchAtStartup !== undefined && typeof patch.launchAtStartup !== "boolean") {
    return "launchAtStartup must be a boolean";
  }

  if (patch.showNotifications !== undefined && typeof patch.showNotifications !== "boolean") {
    return "showNotifications must be a boolean";
  }

  if (patch.whitelistRules !== undefined) {
    if (!Array.isArray(patch.whitelistRules)) {
      return "whitelistRules must be an array";
    }
    for (const rule of patch.whitelistRules) {
      if (typeof rule !== "object" || rule === null) {
        return "Each whitelist rule must be an object";
      }
      if (rule.type === "extension") {
        if (!/^\.[a-z0-9]{1,10}$/i.test(rule.value)) {
          return `Whitelist extension rule value must match /^\\.[a-z0-9]{1,10}$/i, got: "${rule.value}"`;
        }
      } else if (rule.type === "filename") {
        if (
          typeof rule.value !== "string" ||
          rule.value.length < 1 ||
          rule.value.length > 255 ||
          /[/\\]/.test(rule.value)
        ) {
          return `Whitelist filename rule value must be 1–255 chars with no path separators, got: "${rule.value}"`;
        }
      }
    }
  }

  return null;
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
    return { success: false, error: "Operation already in progress" };
  }
  pendingOps.add(key);
  let result: T | Promise<T>;
  try {
    result = fn();
  } catch (err) {
    pendingOps.delete(key);
    throw err;
  }
  if (result instanceof Promise) {
    return result.finally(() => pendingOps.delete(key));
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
  app.quit();
} else {
  app.on("second-instance", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

app.whenReady().then(async () => {
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
  }

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
  stopUpdater();
});
