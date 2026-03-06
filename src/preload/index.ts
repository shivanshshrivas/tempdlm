import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_EVENTS,
  IPC_INVOKE,
  type IpcResult,
  type QueueItem,
  type UserSettings,
  type SetTimerPayload,
  type CancelPayload,
  type SnoozePayload,
  type ConfirmDeletePayload,
  type ConfirmResponsePayload,
  type AppUpdateInfo,
  type UpdateProgress,
} from "../shared/types";

// ─── Exposed API ──────────────────────────────────────────────────────────────
// This is the only surface the renderer can access from Node/Electron.

function unwrapIpcResult<T>(res: IpcResult<T>): T {
  if (!res.success) {
    throw new Error(res.error ?? "Unknown IPC error");
  }
  return res.data;
}

const api = {
  // ── Queries ────────────────────────────────────────────────────────────────

  getQueue: async (): Promise<QueueItem[]> => {
    const res = (await ipcRenderer.invoke(IPC_INVOKE.QUEUE_GET)) as IpcResult<QueueItem[]>;
    return unwrapIpcResult(res);
  },

  getSettings: async (): Promise<UserSettings> => {
    const res = (await ipcRenderer.invoke(IPC_INVOKE.SETTINGS_GET)) as IpcResult<UserSettings>;
    return unwrapIpcResult(res);
  },

  // ── Commands ───────────────────────────────────────────────────────────────

  setTimer: async (payload: SetTimerPayload): Promise<void> => {
    const res = (await ipcRenderer.invoke(IPC_INVOKE.FILE_SET_TIMER, payload)) as IpcResult;
    unwrapIpcResult(res);
  },

  cancelItem: async (payload: CancelPayload): Promise<void> => {
    const res = (await ipcRenderer.invoke(IPC_INVOKE.FILE_CANCEL, payload)) as IpcResult;
    unwrapIpcResult(res);
  },

  snoozeItem: async (payload: SnoozePayload): Promise<void> => {
    const res = (await ipcRenderer.invoke(IPC_INVOKE.FILE_SNOOZE, payload)) as IpcResult;
    unwrapIpcResult(res);
  },

  updateSettings: async (settings: Partial<UserSettings>): Promise<IpcResult<UserSettings>> => {
    return (await ipcRenderer.invoke(
      IPC_INVOKE.SETTINGS_UPDATE,
      settings,
    )) as IpcResult<UserSettings>;
  },

  removeItem: async (payload: { itemId: string }): Promise<void> => {
    const res = (await ipcRenderer.invoke(IPC_INVOKE.FILE_REMOVE, payload)) as IpcResult;
    unwrapIpcResult(res);
  },

  confirmDeleteResponse: async (payload: ConfirmResponsePayload): Promise<void> => {
    const res = (await ipcRenderer.invoke(IPC_INVOKE.FILE_CONFIRM_RESPONSE, payload)) as IpcResult;
    unwrapIpcResult(res);
  },

  pickFolder: async (): Promise<string | null> => {
    const res = (await ipcRenderer.invoke("dialog:pick-folder")) as IpcResult<string | null>;
    return unwrapIpcResult(res);
  },

  // ── Update commands ─────────────────────────────────────────────────────────

  getAppVersion: async (): Promise<string> => {
    const res = (await ipcRenderer.invoke(IPC_INVOKE.APP_GET_VERSION)) as IpcResult<string>;
    return unwrapIpcResult(res);
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
