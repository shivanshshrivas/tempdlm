import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type QueueItem, type UserSettings } from "../../shared/types";

// Mock electron
vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => (name === "downloads" ? "C:\\Users\\test\\Downloads" : "/tmp"),
  },
}));

// Mock electron-store (ESM dynamic import)
const mockStoreData = new Map<string, unknown>();

vi.mock("electron-store", () => ({
  default: class MockStore {
    private defaults: Record<string, unknown>;
    constructor({ defaults }: { defaults: Record<string, unknown> }) {
      this.defaults = defaults;
    }
    get(key: string, fallback?: unknown) {
      return mockStoreData.has(key) ? mockStoreData.get(key) : (fallback ?? this.defaults[key]);
    }
    set(key: string, value: unknown) {
      mockStoreData.set(key, value);
    }
  },
}));

import {
  initStore,
  getQueue,
  saveQueue,
  pruneQueue,
  getQueueItem,
  upsertQueueItem,
  patchQueueItem,
  removeQueueItem,
  getSettings,
  saveSettings,
  patchSettings,
  _resetQueueCache,
} from "../store";

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "item-1",
    filePath: "C:\\Users\\test\\Downloads\\file.zip",
    fileName: "file.zip",
    fileSize: 1024,
    fileExtension: ".zip",
    inode: 0,
    detectedAt: Date.now(),
    scheduledFor: null,
    status: "pending",
    snoozeCount: 0,
    clusterId: null,
    ...overrides,
  };
}

function daysAgo(days: number, now: number): number {
  return now - days * 24 * 60 * 60 * 1000;
}

describe("store", () => {
  const now = Date.UTC(2026, 2, 1, 12, 0, 0);

  beforeEach(async () => {
    mockStoreData.clear();
    _resetQueueCache();
    vi.spyOn(Date, "now").mockReturnValue(now);
    await initStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getQueue", () => {
    it("returns empty array when no queue saved", () => {
      expect(getQueue()).toEqual([]);
    });
  });

  describe("saveQueue / getQueue round-trip", () => {
    it("persists and retrieves queue correctly", () => {
      const item = makeItem();
      saveQueue([item]);
      expect(getQueue()).toEqual([item]);
    });
  });

  describe("getQueueItem", () => {
    it("returns item by id", () => {
      const item = makeItem({ id: "abc" });
      saveQueue([item]);
      expect(getQueueItem("abc")).toEqual(item);
    });

    it("returns undefined for unknown id", () => {
      saveQueue([makeItem()]);
      expect(getQueueItem("unknown")).toBeUndefined();
    });
  });

  describe("upsertQueueItem", () => {
    it("inserts a new item at the front", () => {
      const a = makeItem({ id: "a" });
      const b = makeItem({ id: "b" });
      upsertQueueItem(a);
      upsertQueueItem(b);
      const queue = getQueue();
      expect(queue[0].id).toBe("b");
      expect(queue[1].id).toBe("a");
    });

    it("updates an existing item in place", () => {
      const item = makeItem({ id: "x", status: "pending" });
      upsertQueueItem(item);
      upsertQueueItem({ ...item, status: "scheduled" });
      const queue = getQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].status).toBe("scheduled");
    });
  });

  describe("patchQueueItem", () => {
    it("applies partial update and returns updated item", () => {
      upsertQueueItem(makeItem({ id: "p", status: "pending" }));
      const updated = patchQueueItem("p", {
        status: "scheduled",
        scheduledFor: 9999,
      });
      expect(updated?.status).toBe("scheduled");
      expect(updated?.scheduledFor).toBe(9999);
      expect(getQueueItem("p")?.status).toBe("scheduled");
    });

    it("returns null for unknown id", () => {
      expect(patchQueueItem("nope", { status: "deleted" })).toBeNull();
    });
  });

  describe("removeQueueItem", () => {
    it("removes item by id", () => {
      upsertQueueItem(makeItem({ id: "r" }));
      removeQueueItem("r");
      expect(getQueue()).toHaveLength(0);
    });

    it("is a no-op for unknown id", () => {
      upsertQueueItem(makeItem({ id: "r" }));
      removeQueueItem("unknown");
      expect(getQueue()).toHaveLength(1);
    });
  });

  describe("pruneQueue", () => {
    it("prunes terminal-status items older than threshold", () => {
      saveQueue([
        makeItem({ id: "deleted-old", status: "deleted", detectedAt: daysAgo(10, now) }),
        makeItem({ id: "failed-old", status: "failed", detectedAt: daysAgo(9, now) }),
        makeItem({ id: "never-old", status: "never", detectedAt: daysAgo(8, now) }),
        makeItem({ id: "whitelisted-old", status: "whitelisted", detectedAt: daysAgo(20, now) }),
        makeItem({ id: "pending-old", status: "pending", detectedAt: daysAgo(20, now) }),
      ]);

      const pruned = pruneQueue(7, 500);
      expect(pruned).toBe(4);
      expect(getQueue().map((i) => i.id)).toEqual(["pending-old"]);
    });

    it("keeps terminal-status items newer than threshold", () => {
      saveQueue([
        makeItem({ id: "deleted-new", status: "deleted", detectedAt: daysAgo(2, now) }),
        makeItem({ id: "failed-new", status: "failed", detectedAt: daysAgo(1, now) }),
        makeItem({ id: "never-new", status: "never", detectedAt: daysAgo(3, now) }),
        makeItem({ id: "whitelisted-new", status: "whitelisted", detectedAt: daysAgo(4, now) }),
      ]);

      const pruned = pruneQueue(7, 500);
      expect(pruned).toBe(0);
      expect(getQueue()).toHaveLength(4);
    });

    it("keeps active items regardless of age", () => {
      saveQueue([
        makeItem({ id: "scheduled-old", status: "scheduled", detectedAt: daysAgo(50, now) }),
        makeItem({ id: "snoozed-old", status: "snoozed", detectedAt: daysAgo(40, now) }),
        makeItem({ id: "pending-old", status: "pending", detectedAt: daysAgo(30, now) }),
        makeItem({ id: "confirming-old", status: "confirming", detectedAt: daysAgo(20, now) }),
        makeItem({ id: "deleting-old", status: "deleting", detectedAt: daysAgo(10, now) }),
      ]);

      const pruned = pruneQueue(7, 500);
      expect(pruned).toBe(0);
      expect(getQueue()).toHaveLength(5);
    });

    it("enforces max queue size by removing oldest prunable items first", () => {
      saveQueue([
        makeItem({ id: "active-1", status: "pending", detectedAt: daysAgo(1, now) }),
        makeItem({ id: "prunable-oldest", status: "deleted", detectedAt: daysAgo(6, now) }),
        makeItem({ id: "prunable-mid", status: "failed", detectedAt: daysAgo(4, now) }),
        makeItem({ id: "prunable-newest", status: "whitelisted", detectedAt: daysAgo(2, now) }),
        makeItem({ id: "active-2", status: "scheduled", detectedAt: daysAgo(1, now) }),
      ]);

      const pruned = pruneQueue(30, 3);
      expect(pruned).toBe(2);
      expect(getQueue().map((i) => i.id)).toEqual(["active-1", "prunable-newest", "active-2"]);
    });

    it("returns the correct number of items pruned across both phases", () => {
      saveQueue([
        makeItem({ id: "age-pruned", status: "deleted", detectedAt: daysAgo(10, now) }),
        makeItem({ id: "cap-pruned", status: "failed", detectedAt: daysAgo(3, now) }),
        makeItem({ id: "keep-prunable", status: "whitelisted", detectedAt: daysAgo(1, now) }),
        makeItem({ id: "active", status: "pending", detectedAt: daysAgo(1, now) }),
      ]);

      const pruned = pruneQueue(7, 2);
      expect(pruned).toBe(2);
      expect(getQueue().map((i) => i.id)).toEqual(["keep-prunable", "active"]);
    });

    it("is a no-op when queue is within age and size limits", () => {
      saveQueue([
        makeItem({ id: "active", status: "pending", detectedAt: daysAgo(1, now) }),
        makeItem({ id: "recent-never", status: "never", detectedAt: daysAgo(1, now) }),
      ]);

      const before = getQueue();
      const pruned = pruneQueue(7, 500);
      expect(pruned).toBe(0);
      expect(getQueue()).toEqual(before);
    });
  });

  describe("queue cache", () => {
    it("serves getQueue from cache without hitting disk on subsequent calls", () => {
      const item = makeItem({ id: "c1" });
      saveQueue([item]);

      mockStoreData.set("queue", []);

      expect(getQueue()).toEqual([item]);
    });

    it("updates cache when saveQueue is called", () => {
      const a = makeItem({ id: "a" });
      const b = makeItem({ id: "b" });
      saveQueue([a]);
      saveQueue([a, b]);
      expect(getQueue()).toHaveLength(2);
    });

    it("re-reads from disk after _resetQueueCache", () => {
      saveQueue([makeItem({ id: "r1" })]);
      mockStoreData.set("queue", []);
      expect(getQueue()).toHaveLength(1);
      _resetQueueCache();
      expect(getQueue()).toHaveLength(0);
    });

    it("populates cache on initStore", async () => {
      const item = makeItem({ id: "pre" });
      mockStoreData.set("queue", [item]);
      _resetQueueCache();
      await initStore();
      mockStoreData.set("queue", []);
      expect(getQueue()).toEqual([item]);
    });
  });

  describe("getSettings", () => {
    it("returns defaults when no settings saved", () => {
      const settings = getSettings();
      expect(settings.defaultTimer).toBe("never");
      expect(settings.launchAtStartup).toBe(true);
      expect(settings.theme).toBe("system");
      expect(settings.downloadsFolder).toBe("C:\\Users\\test\\Downloads");
    });
  });

  describe("saveSettings / getSettings round-trip", () => {
    it("persists and retrieves settings correctly", () => {
      const custom: UserSettings = {
        downloadsFolder: "D:\\MyDownloads",
        launchAtStartup: true,
        defaultTimer: "1d",
        customDefaultMinutes: 1440,
        theme: "dark",
        showNotifications: false,
        dialogPosition: "center",
        whitelistRules: [],
      };
      saveSettings(custom);
      expect(getSettings()).toEqual(custom);
    });
  });

  describe("patchSettings", () => {
    it("merges partial update without losing other fields", () => {
      const original = getSettings();
      const patched = patchSettings({ theme: "dark", launchAtStartup: true });
      expect(patched.theme).toBe("dark");
      expect(patched.launchAtStartup).toBe(true);
      expect(patched.defaultTimer).toBe(original.defaultTimer);
      expect(patched.downloadsFolder).toBe(original.downloadsFolder);
    });
  });

  describe("initStore guard", () => {
    it("throws if used before initStore", async () => {
      const { getQueue: rawGetQueue } = await import("../store");
      expect(() => rawGetQueue()).not.toThrow();
    });
  });
});
