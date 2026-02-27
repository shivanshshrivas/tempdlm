// ─── Queue Item ───────────────────────────────────────────────────────────────


export type QueueItemStatus =
  | "pending"
  | "scheduled"
  | "snoozed"
  | "confirming"
  | "deleting"
  | "deleted"
  | "failed"
  | "whitelisted";

export interface QueueItem {
  id: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  fileExtension: string;
  inode: number; // NTFS file ID — survives renames, used for rename tracking
  detectedAt: number; // Unix timestamp ms
  scheduledFor: number | null; // Unix timestamp ms, null = never delete
  status: QueueItemStatus;
  snoozeCount: number;
  clusterId: string | null;
  error?: string;
}

// ─── User Settings ────────────────────────────────────────────────────────────

export type TimerPreset = "5m" | "30m" | "2h" | "1d" | "never" | "custom";

export interface UserSettings {
  downloadsFolder: string;
  launchAtStartup: boolean;
  defaultTimer: TimerPreset;
  customDefaultMinutes: number;
  theme: "system" | "light" | "dark";
  showNotifications: boolean;
  dialogPosition: "center" | "bottom-right" | "near-tray";
  whitelistRules: WhitelistRule[];
}

// ─── Whitelist ────────────────────────────────────────────────────────────────

export type WhitelistRuleType = "extension" | "filename" | "pattern";
export type WhitelistAction = "never-delete" | "auto-delete-after";

export interface WhitelistRule {
  id: string;
  type: WhitelistRuleType;
  value: string; // e.g. ".pdf", "temp_*", "setup.exe"
  action: WhitelistAction;
  autoDeleteMinutes?: number; // only when action = 'auto-delete-after'
  enabled: boolean;
}

// ─── Auto-Update ─────────────────────────────────────────────────────────────

export interface AppUpdateInfo {
  version: string;
  releaseDate: string; // ISO date from GitHub Release
  releaseNotes: string; // Markdown/HTML body from GitHub Release
  releaseNotesUrl: string; // GitHub release URL for "View full notes" link
}

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

// ─── IPC Channels ────────────────────────────────────────────────────────────

// Main → Renderer events
export const IPC_EVENTS = {
  FILE_NEW: "file:new",
  FILE_DELETED: "file:deleted",
  FILE_IN_USE: "file:in-use",
  FILE_CONFIRM_DELETE: "file:confirm-delete",
  QUEUE_UPDATED: "queue:updated",
  UPDATE_AVAILABLE: "update:available",
  UPDATE_PROGRESS: "update:download-progress",
  UPDATE_DOWNLOADED: "update:downloaded",
  UPDATE_ERROR: "update:error",
} as const;

// Renderer → Main invocations
export const IPC_INVOKE = {
  FILE_SET_TIMER: "file:set-timer",
  FILE_CANCEL: "file:cancel",
  FILE_SNOOZE: "file:snooze",
  FILE_REMOVE: "file:remove",
  FILE_CONFIRM_RESPONSE: "file:confirm-response",
  SETTINGS_GET: "settings:get",
  SETTINGS_UPDATE: "settings:update",
  QUEUE_GET: "queue:get",
  APP_GET_VERSION: "app:get-version",
  UPDATE_CHECK: "update:check",
  UPDATE_DOWNLOAD: "update:download",
  UPDATE_INSTALL: "update:install",
  OPEN_EXTERNAL: "shell:open-external",
} as const;

// ─── IPC Payloads ────────────────────────────────────────────────────────────

export interface SetTimerPayload {
  itemId: string;
  minutes: number | null; // null = never delete
}

export interface SnoozePayload {
  itemId: string;
}

export interface CancelPayload {
  itemId: string;
}

export interface ConfirmDeletePayload {
  item: QueueItem;
  processNames: string[];
  timeoutMs: number;
  /** Unix timestamp (ms) when the main-process confirmation timer started. */
  confirmationStartedAt: number;
}

export interface ConfirmResponsePayload {
  itemId: string;
  decision: "delete" | "keep";
}
