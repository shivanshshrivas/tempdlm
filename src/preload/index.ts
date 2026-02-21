import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_EVENTS,
  IPC_INVOKE,
  QueueItem,
  UserSettings,
  SetTimerPayload,
  CancelPayload,
  SnoozePayload,
} from '../shared/types'

// ─── Exposed API ──────────────────────────────────────────────────────────────
// This is the only surface the renderer can access from Node/Electron.

const api = {
  // ── Queries ────────────────────────────────────────────────────────────────

  getQueue: (): Promise<QueueItem[]> =>
    ipcRenderer.invoke(IPC_INVOKE.QUEUE_GET),

  getSettings: (): Promise<UserSettings> =>
    ipcRenderer.invoke(IPC_INVOKE.SETTINGS_GET),

  // ── Commands ───────────────────────────────────────────────────────────────

  setTimer: (payload: SetTimerPayload): Promise<void> =>
    ipcRenderer.invoke(IPC_INVOKE.FILE_SET_TIMER, payload),

  cancelItem: (payload: CancelPayload): Promise<void> =>
    ipcRenderer.invoke(IPC_INVOKE.FILE_CANCEL, payload),

  snoozeItem: (payload: SnoozePayload): Promise<void> =>
    ipcRenderer.invoke(IPC_INVOKE.FILE_SNOOZE, payload),

  updateSettings: (settings: Partial<UserSettings>): Promise<void> =>
    ipcRenderer.invoke(IPC_INVOKE.SETTINGS_UPDATE, settings),

  // ── Event subscriptions ────────────────────────────────────────────────────
  // Returns an unsubscribe function.

  onFileNew: (callback: (item: QueueItem) => void) => {
    const handler = (_: Electron.IpcRendererEvent, item: QueueItem) => callback(item)
    ipcRenderer.on(IPC_EVENTS.FILE_NEW, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.FILE_NEW, handler)
  },

  onFileDeleted: (callback: (itemId: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, itemId: string) => callback(itemId)
    ipcRenderer.on(IPC_EVENTS.FILE_DELETED, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.FILE_DELETED, handler)
  },

  onFileInUse: (callback: (item: QueueItem) => void) => {
    const handler = (_: Electron.IpcRendererEvent, item: QueueItem) => callback(item)
    ipcRenderer.on(IPC_EVENTS.FILE_IN_USE, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.FILE_IN_USE, handler)
  },

  onQueueUpdated: (callback: (queue: QueueItem[]) => void) => {
    const handler = (_: Electron.IpcRendererEvent, queue: QueueItem[]) => callback(queue)
    ipcRenderer.on(IPC_EVENTS.QUEUE_UPDATED, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.QUEUE_UPDATED, handler)
  },
}

contextBridge.exposeInMainWorld('tempdlm', api)

// ─── Type declaration for renderer ───────────────────────────────────────────
// Keep this in sync with the api object above.

export type TempDLMApi = typeof api
