import { app } from "electron";
import type ElectronStore from "electron-store";
import { type QueueItem, type UserSettings } from "../shared/types";
import log from "./logger";

// electron-store v11 is ESM-only, so we use a dynamic import at module level
// and expose a sync-style API after initialisation.

// ─── Types ───────────────────────────────────────────────────────────────────

interface StoreSchema {
  queue: QueueItem[];
  settings: UserSettings;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PRUNE_STATUSES: QueueItem["status"][] = ["deleted", "failed", "never", "whitelisted"];
const DEFAULT_PRUNE_DAYS = 7;
const MAX_QUEUE_SIZE = 500;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── Default values ──────────────────────────────────────────────────────────

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

// ─── Internal store instance ─────────────────────────────────────────────────

let _store: ElectronStore<StoreSchema> | null = null;

// In-memory cache - avoids full disk reads on every getQueue() call.
// Populated on initStore(); kept in sync by saveQueue() (write-through).
let _queueCache: QueueItem[] | null = null;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Must be called once before any other store function, after `app.whenReady()`.
 */
export async function initStore(): Promise<void> {
  try {
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
    }) as unknown as ElectronStore<StoreSchema>;

    _queueCache = _store.get("queue", []);
    log.info("[store] initialised", { queueSize: _queueCache.length });
  } catch (error) {
    log.error("[store] failed to initialise", { error: getErrorMessage(error) });
    throw error;
  }
}

function assertInitialised(): void {
  if (!_store) {
    log.error("[store] attempted to use store before init");
    throw new Error("Store not initialised - call initStore() first");
  }
}

// ─── Queue helpers ───────────────────────────────────────────────────────────

/**
 * Returns the full queue from the in-memory cache (populated on init).
 * @returns The current array of QueueItems, newest first.
 */
export function getQueue(): QueueItem[] {
  assertInitialised();
  if (_queueCache !== null) return _queueCache;
  // Defensive fallback - should only happen if initStore() was bypassed
  try {
    _queueCache = _store.get("queue", []);
  } catch (error) {
    log.error("[store] failed to read queue", { error: getErrorMessage(error) });
    throw error;
  }
  return _queueCache;
}

/**
 * Writes the full queue array to disk and updates the in-memory cache.
 * @param queue - The queue array to persist.
 */
export function saveQueue(queue: QueueItem[]): void {
  assertInitialised();
  try {
    _store.set("queue", queue);
    _queueCache = [...queue];
  } catch (error) {
    log.error("[store] failed to write queue", {
      queueSize: queue.length,
      error: getErrorMessage(error),
    });
    throw error;
  }
}

function isPrunableStatus(status: QueueItem["status"]): boolean {
  return PRUNE_STATUSES.includes(status);
}

function getDetectedAtMs(item: QueueItem): number {
  return Number.isFinite(item.detectedAt) ? item.detectedAt : 0;
}

/**
 * Prunes stale terminal-status queue items and enforces a hard queue size cap.
 * @param olderThanDays - Remove prunable items older than this many days.
 * @param maxItems - Maximum queue size after pruning oldest prunable items.
 * @returns Number of items removed from the queue.
 */
export function pruneQueue(olderThanDays = DEFAULT_PRUNE_DAYS, maxItems = MAX_QUEUE_SIZE): number {
  const queue = getQueue();
  const cutoffMs = Date.now() - Math.max(0, olderThanDays) * MS_PER_DAY;

  let prunedQueue = queue.filter((item) => {
    const isOldPrunable = isPrunableStatus(item.status) && getDetectedAtMs(item) < cutoffMs;
    return !isOldPrunable;
  });

  if (prunedQueue.length > maxItems) {
    const overflow = prunedQueue.length - maxItems;
    const oldestPrunable = prunedQueue
      .filter((item) => isPrunableStatus(item.status))
      .sort((a, b) => getDetectedAtMs(a) - getDetectedAtMs(b))
      .slice(0, overflow);

    if (oldestPrunable.length > 0) {
      const idsToRemove = new Set(oldestPrunable.map((item) => item.id));
      prunedQueue = prunedQueue.filter((item) => !idsToRemove.has(item.id));
    }
  }

  const prunedCount = queue.length - prunedQueue.length;
  if (prunedCount > 0) {
    saveQueue(prunedQueue);
  }
  return prunedCount;
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
 * Resets the in-memory queue cache. Test-only - forces the next getQueue()
 * to re-read from the underlying store.
 */
export function _resetQueueCache(): void {
  _queueCache = null;
}

// ─── Settings helpers ────────────────────────────────────────────────────────

/**
 * Returns the current user settings from the persistent store.
 * @returns The stored UserSettings object.
 */
export function getSettings(): UserSettings {
  assertInitialised();
  try {
    return _store.get("settings", defaultSettings());
  } catch (error) {
    log.error("[store] failed to read settings", { error: getErrorMessage(error) });
    throw error;
  }
}

/**
 * Writes a complete UserSettings object to the persistent store.
 * @param settings - The complete UserSettings to persist.
 */
export function saveSettings(settings: UserSettings): void {
  assertInitialised();
  try {
    _store.set("settings", settings);
  } catch (error) {
    log.error("[store] failed to write settings", { error: getErrorMessage(error) });
    throw error;
  }
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
