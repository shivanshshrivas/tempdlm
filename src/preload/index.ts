import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_EVENTS,
  IPC_INVOKE,
  QueueItem,
  UserSettings,
  SetTimerPayload,
  CancelPayload,
  SnoozePayload,
  ConfirmDeletePayload,
  ConfirmResponsePayload,
  AppUpdateInfo,
  UpdateProgress,
} from "../shared/types";

// ─── Exposed API ──────────────────────────────────────────────────────────────
// This is the only surface the renderer can access from Node/Electron.

const api = {
  // ── Queries ────────────────────────────────────────────────────────────────

  getQueue: async (): Promise<QueueItem[]> => {
    const res = await ipcRenderer.invoke(IPC_INVOKE.QUEUE_GET);
    return res.data as QueueItem[];
  },

  getSettings: async (): Promise<UserSettings> => {
    const res = await ipcRenderer.invoke(IPC_INVOKE.SETTINGS_GET);
    return res.data as UserSettings;
  },

  // ── Commands ───────────────────────────────────────────────────────────────

  setTimer: (payload: SetTimerPayload): Promise<void> =>
    ipcRenderer.invoke(IPC_INVOKE.FILE_SET_TIMER, payload),

  cancelItem: (payload: CancelPayload): Promise<void> =>
    ipcRenderer.invoke(IPC_INVOKE.FILE_CANCEL, payload),

  snoozeItem: (payload: SnoozePayload): Promise<void> =>
    ipcRenderer.invoke(IPC_INVOKE.FILE_SNOOZE, payload),

  updateSettings: async (
    settings: Partial<UserSettings>,
  ): Promise<{ success: boolean; error?: string }> => {
    const res = await ipcRenderer.invoke(IPC_INVOKE.SETTINGS_UPDATE, settings);
    return res as { success: boolean; error?: string };
  },

  removeItem: (payload: { itemId: string }): Promise<void> =>
    ipcRenderer.invoke(IPC_INVOKE.FILE_REMOVE, payload),

  confirmDeleteResponse: (payload: ConfirmResponsePayload): Promise<void> =>
    ipcRenderer.invoke(IPC_INVOKE.FILE_CONFIRM_RESPONSE, payload),

  pickFolder: async (): Promise<string | null> => {
    const res = await ipcRenderer.invoke("dialog:pick-folder");
    return res.data as string | null;
  },

  // ── Update commands ─────────────────────────────────────────────────────────

  getAppVersion: async (): Promise<string> => {
    const res = await ipcRenderer.invoke(IPC_INVOKE.APP_GET_VERSION);
    return res.data as string;
  },

  checkForUpdate: (): Promise<void> => ipcRenderer.invoke(IPC_INVOKE.UPDATE_CHECK),

  downloadUpdate: (): Promise<void> => ipcRenderer.invoke(IPC_INVOKE.UPDATE_DOWNLOAD),

  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC_INVOKE.UPDATE_INSTALL),

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC_INVOKE.OPEN_EXTERNAL, url),

  // ── Event subscriptions ────────────────────────────────────────────────────
  // Returns an unsubscribe function.

  onFileNew: (callback: (item: QueueItem) => void) => {
    const handler = (_: Electron.IpcRendererEvent, item: QueueItem) => callback(item);
    ipcRenderer.on(IPC_EVENTS.FILE_NEW, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.FILE_NEW, handler);
  },

  onFileDeleted: (callback: (itemId: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, itemId: string) => callback(itemId);
    ipcRenderer.on(IPC_EVENTS.FILE_DELETED, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.FILE_DELETED, handler);
  },

  onFileInUse: (callback: (item: QueueItem) => void) => {
    const handler = (_: Electron.IpcRendererEvent, item: QueueItem) => callback(item);
    ipcRenderer.on(IPC_EVENTS.FILE_IN_USE, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.FILE_IN_USE, handler);
  },

  onFileConfirmDelete: (callback: (payload: ConfirmDeletePayload) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: ConfirmDeletePayload) =>
      callback(payload);
    ipcRenderer.on(IPC_EVENTS.FILE_CONFIRM_DELETE, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.FILE_CONFIRM_DELETE, handler);
  },

  onQueueUpdated: (callback: (queue: QueueItem[]) => void) => {
    const handler = (_: Electron.IpcRendererEvent, queue: QueueItem[]) => callback(queue);
    ipcRenderer.on(IPC_EVENTS.QUEUE_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.QUEUE_UPDATED, handler);
  },

  // ── Update event subscriptions ──────────────────────────────────────────────

  onUpdateAvailable: (callback: (info: AppUpdateInfo) => void) => {
    const handler = (_: Electron.IpcRendererEvent, info: AppUpdateInfo) => callback(info);
    ipcRenderer.on(IPC_EVENTS.UPDATE_AVAILABLE, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.UPDATE_AVAILABLE, handler);
  },

  onUpdateProgress: (callback: (progress: UpdateProgress) => void) => {
    const handler = (_: Electron.IpcRendererEvent, progress: UpdateProgress) => callback(progress);
    ipcRenderer.on(IPC_EVENTS.UPDATE_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.UPDATE_PROGRESS, handler);
  },

  onUpdateDownloaded: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on(IPC_EVENTS.UPDATE_DOWNLOADED, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.UPDATE_DOWNLOADED, handler);
  },

  onUpdateError: (callback: (message: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on(IPC_EVENTS.UPDATE_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.UPDATE_ERROR, handler);
  },
};

contextBridge.exposeInMainWorld("tempdlm", api);

// ─── Type declaration for renderer ───────────────────────────────────────────
// Keep this in sync with the api object above.

export type TempDLMApi = typeof api;
