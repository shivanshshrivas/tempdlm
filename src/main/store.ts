import { app } from "electron";
import { type QueueItem, type UserSettings } from "../shared/types";

// electron-store v11 is ESM-only, so we use a dynamic import at module level
// and expose a sync-style API after initialisation.

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoreSchema {
  queue: QueueItem[];
  settings: UserSettings;
}

// ─── Default values ───────────────────────────────────────────────────────────

function defaultSettings(): UserSettings {
  return {
    downloadsFolder: app.getPath("downloads"),
    launchAtStartup: true,
    defaultTimer: "30m",
    customDefaultMinutes: 60,
    theme: "system",
    showNotifications: true,
    dialogPosition: "bottom-right",
    whitelistRules: [],
  };
}

// ─── Internal store instance ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _store: any = null;

/**
 * Must be called once before any other store function, after `app.whenReady()`.
 */
export async function initStore(): Promise<void> {
  // Dynamic import required for ESM-only electron-store
  const { default: Store } = await import("electron-store");

  _store = new Store<StoreSchema>({
    name: "tempdlm",
    defaults: {
      queue: [],
      settings: defaultSettings(),
    },
    // Migrate old schemas forward if needed in future versions
    migrations: {},
  });
}

function assertInitialised(): void {
  if (!_store) {
    throw new Error("Store not initialised — call initStore() first");
  }
}

// ─── Queue helpers ────────────────────────────────────────────────────────────

export function getQueue(): QueueItem[] {
  assertInitialised();
  return _store.get("queue", []) as QueueItem[];
}

export function saveQueue(queue: QueueItem[]): void {
  assertInitialised();
  _store.set("queue", queue);
}

export function getQueueItem(itemId: string): QueueItem | undefined {
  return getQueue().find((i) => i.id === itemId);
}

export function upsertQueueItem(item: QueueItem): void {
  const queue = getQueue();
  const idx = queue.findIndex((i) => i.id === item.id);
  if (idx === -1) {
    queue.unshift(item); // newest first
  } else {
    queue[idx] = item;
  }
  saveQueue(queue);
}

export function patchQueueItem(itemId: string, patch: Partial<QueueItem>): QueueItem | null {
  const queue = getQueue();
  const idx = queue.findIndex((i) => i.id === itemId);
  if (idx === -1) return null;
  queue[idx] = { ...queue[idx], ...patch };
  saveQueue(queue);
  return queue[idx];
}

export function removeQueueItem(itemId: string): void {
  const queue = getQueue().filter((i) => i.id !== itemId);
  saveQueue(queue);
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

export function getSettings(): UserSettings {
  assertInitialised();
  return _store.get("settings", defaultSettings()) as UserSettings;
}

export function saveSettings(settings: UserSettings): void {
  assertInitialised();
  _store.set("settings", settings);
}

export function patchSettings(patch: Partial<UserSettings>): UserSettings {
  const current = getSettings();
  const updated = { ...current, ...patch };
  saveSettings(updated);
  return updated;
}
