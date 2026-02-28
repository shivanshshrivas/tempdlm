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
    defaultTimer: "never",
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

// In-memory cache — avoids full disk reads on every getQueue() call.
// Populated on initStore(); kept in sync by saveQueue() (write-through).
let _queueCache: QueueItem[] | null = null;

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

  _queueCache = _store.get("queue", []) as QueueItem[];
}

function assertInitialised(): void {
  if (!_store) {
    throw new Error("Store not initialised — call initStore() first");
  }
}

// ─── Queue helpers ────────────────────────────────────────────────────────────

/**
 * Returns the full queue from the in-memory cache (populated on init).
 * @returns The current array of QueueItems, newest first.
 */
export function getQueue(): QueueItem[] {
  assertInitialised();
  if (_queueCache !== null) return _queueCache;
  // Defensive fallback — should only happen if initStore() was bypassed
  _queueCache = _store.get("queue", []) as QueueItem[];
  return _queueCache;
}

/**
 * Writes the full queue array to disk and updates the in-memory cache.
 * @param queue - The queue array to persist.
 */
export function saveQueue(queue: QueueItem[]): void {
  assertInitialised();
  _store.set("queue", queue);
  _queueCache = [...queue];
}

/**
 * Returns the queue item with the given ID, or undefined if not found.
 * @param itemId - The unique item ID to look up.
 * @returns The matching QueueItem, or undefined if absent.
 */
export function getQueueItem(itemId: string): QueueItem | undefined {
  return getQueue().find((i) => i.id === itemId);
}

/**
 * Inserts the item at the front of the queue (newest first), or replaces it
 * in-place if an item with the same ID already exists.
 * @param item - The QueueItem to insert or update.
 */
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

/**
 * Merges the patch into the queue item with the given ID and persists the change.
 * @param itemId - The unique item ID to patch.
 * @param patch - Partial QueueItem fields to merge in.
 * @returns The updated QueueItem, or null if the item was not found.
 */
export function patchQueueItem(itemId: string, patch: Partial<QueueItem>): QueueItem | null {
  const queue = getQueue();
  const idx = queue.findIndex((i) => i.id === itemId);
  if (idx === -1) return null;
  queue[idx] = { ...queue[idx], ...patch };
  saveQueue(queue);
  return queue[idx];
}

/**
 * Removes the item with the given ID from the queue and persists the change.
 * @param itemId - The unique item ID to remove.
 */
export function removeQueueItem(itemId: string): void {
  const queue = getQueue().filter((i) => i.id !== itemId);
  saveQueue(queue);
}

/**
 * Resets the in-memory queue cache. Test-only — forces the next getQueue()
 * to re-read from the underlying store.
 */
export function _resetQueueCache(): void {
  _queueCache = null;
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

/**
 * Returns the current user settings from the persistent store.
 * @returns The stored UserSettings object.
 */
export function getSettings(): UserSettings {
  assertInitialised();
  return _store.get("settings", defaultSettings()) as UserSettings;
}

/**
 * Writes a complete UserSettings object to the persistent store.
 * @param settings - The complete UserSettings to persist.
 */
export function saveSettings(settings: UserSettings): void {
  assertInitialised();
  _store.set("settings", settings);
}

/**
 * Merges a partial patch into the current settings and persists the result.
 * @param patch - Partial UserSettings fields to merge in.
 * @returns The resulting complete UserSettings after the merge.
 */
export function patchSettings(patch: Partial<UserSettings>): UserSettings {
  const current = getSettings();
  const updated = { ...current, ...patch };
  saveSettings(updated);
  return updated;
}
