import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueueItem } from "../../shared/types";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("electron", () => ({
  app: { getPath: () => "C:\\Users\\test\\Downloads" },
}));

vi.mock("electron-store", () => ({
  default: class {
    private data: Record<string, unknown> = {};
    get(key: string, fallback: unknown) {
      return this.data[key] ?? fallback;
    }
    set(key: string, val: unknown) {
      this.data[key] = val;
    }
  },
}));

// ── Store mock ────────────────────────────────────────────────────────────────

const mockQueue = new Map<string, QueueItem>();

vi.mock("../store", () => ({
  getQueue: () => Array.from(mockQueue.values()),
  saveQueue: vi.fn(),
  getQueueItem: (id: string) => mockQueue.get(id),
  patchQueueItem: vi.fn((id: string, patch: Partial<QueueItem>) => {
    const item = mockQueue.get(id);
    if (!item) return null;
    const updated = { ...item, ...patch };
    mockQueue.set(id, updated);
    return updated;
  }),
}));

// ── node-schedule mock ────────────────────────────────────────────────────────

const mockJobs = new Map<string, { cancel: ReturnType<typeof vi.fn>; callback: () => void }>();
let jobIdCounter = 0;

vi.mock("node-schedule", () => ({
  scheduleJob: vi.fn((date: Date, callback: () => void) => {
    const id = String(jobIdCounter++);
    const job = { cancel: vi.fn(), callback, id };
    mockJobs.set(id, job);
    return job;
  }),
}));

// ── trash mock ────────────────────────────────────────────────────────────────

// Use a stable mock fn referenced via the module — dynamic import() in the
// engine resolves through Vitest's module registry just like static imports.
vi.mock("trash", () => ({ default: vi.fn().mockResolvedValue(undefined) }));

// ── fs mock ───────────────────────────────────────────────────────────────────

let fileExists = true;
let fileLocked = false;
let windowTitleProcesses: string[] = [];

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => fileExists),
  },
}));

// ── child_process mock (PowerShell lock probe + window-title heuristic) ──────

vi.mock("child_process", () => ({
  spawnSync: vi.fn((_cmd: string, args: string[]) => {
    const script = args?.[args.length - 1] ?? "";

    // Restart Manager call (contains 'RmCheck')
    if (script.includes("RmCheck")) {
      return { status: fileLocked ? 1 : 0, error: undefined };
    }

    // Get-Process call (window-title heuristic)
    if (script.includes("Get-Process")) {
      return {
        status: 0,
        error: undefined,
        stdout: Buffer.from(windowTitleProcesses.join("\r\n")),
      };
    }

    return { status: 0, error: undefined };
  }),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  initDeletionEngine,
  scheduleItem,
  cancelItem,
  snoozeItem,
  reconcileOnStartup,
  cancelAllJobs,
  resolveConfirmation,
  _getJobs,
} from "../deletionEngine";
import { patchQueueItem } from "../store";
import * as schedule from "node-schedule";
import * as trashModule from "trash";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "item-1",
    filePath: "C:\\Users\\test\\Downloads\\file.zip",
    fileName: "file.zip",
    fileSize: 1024,
    fileExtension: ".zip",
    inode: 12345,
    detectedAt: Date.now(),
    scheduledFor: null,
    status: "pending",
    snoozeCount: 0,
    clusterId: null,
    ...overrides,
  };
}

function makeFakeWindow() {
  return {
    webContents: { send: vi.fn() },
  } as unknown as import("electron").BrowserWindow;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("deletionEngine", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockQueue.clear();
    mockJobs.clear();
    jobIdCounter = 0;
    fileExists = true;
    fileLocked = false;
    windowTitleProcesses = [];
    cancelAllJobs();
    await initDeletionEngine();
  });

  // ── scheduleItem ────────────────────────────────────────────────────────────

  describe("scheduleItem", () => {
    it("creates a node-schedule job at the correct time", () => {
      const item = makeItem({ id: "a" });
      mockQueue.set("a", item);
      const win = makeFakeWindow();

      scheduleItem(item, 30, win);

      expect(schedule.scheduleJob).toHaveBeenCalledOnce();
      expect(_getJobs().size).toBe(1);
      expect(patchQueueItem).toHaveBeenCalledWith(
        "a",
        expect.objectContaining({
          status: "scheduled",
        }),
      );
    });

    it("sets status to pending and no job when minutes is null (never delete)", () => {
      const item = makeItem({ id: "b" });
      mockQueue.set("b", item);
      const win = makeFakeWindow();

      scheduleItem(item, null, win);

      expect(schedule.scheduleJob).not.toHaveBeenCalled();
      expect(patchQueueItem).toHaveBeenCalledWith("b", {
        status: "pending",
        scheduledFor: null,
      });
    });

    it("cancels an existing job before creating a new one", () => {
      const item = makeItem({ id: "c" });
      mockQueue.set("c", item);
      const win = makeFakeWindow();

      scheduleItem(item, 30, win);
      const firstJobCancel = vi.mocked(schedule.scheduleJob).mock.results[0].value.cancel;

      scheduleItem(item, 60, win);

      expect(firstJobCancel).toHaveBeenCalled();
      expect(schedule.scheduleJob).toHaveBeenCalledTimes(2);
    });
  });

  // ── cancelItem ──────────────────────────────────────────────────────────────

  describe("cancelItem", () => {
    it("cancels the job and resets item to pending", () => {
      const item = makeItem({ id: "d", status: "scheduled" });
      mockQueue.set("d", item);
      const win = makeFakeWindow();

      scheduleItem(item, 30, win);
      cancelItem("d");

      const jobCancel = vi.mocked(schedule.scheduleJob).mock.results[0].value.cancel;
      expect(jobCancel).toHaveBeenCalled();
      expect(patchQueueItem).toHaveBeenLastCalledWith("d", {
        status: "pending",
        scheduledFor: null,
      });
    });

    it("is a no-op for an item with no job", () => {
      mockQueue.set("e", makeItem({ id: "e" }));
      cancelItem("e"); // no job registered
      expect(patchQueueItem).toHaveBeenCalledWith("e", {
        status: "pending",
        scheduledFor: null,
      });
    });
  });

  // ── snoozeItem ──────────────────────────────────────────────────────────────

  describe("snoozeItem", () => {
    it("reschedules item and increments snoozeCount", () => {
      const item = makeItem({ id: "f", snoozeCount: 0 });
      mockQueue.set("f", item);
      const win = makeFakeWindow();

      snoozeItem("f", win);

      expect(patchQueueItem).toHaveBeenCalledWith(
        "f",
        expect.objectContaining({
          status: "snoozed",
          snoozeCount: 1,
        }),
      );
      expect(schedule.scheduleJob).toHaveBeenCalledOnce();
    });

    it("is a no-op for unknown itemId", () => {
      const win = makeFakeWindow();
      snoozeItem("unknown", win);
      expect(patchQueueItem).not.toHaveBeenCalled();
    });
  });

  // ── reconcileOnStartup ──────────────────────────────────────────────────────

  describe("reconcileOnStartup", () => {
    it("re-registers jobs for future-scheduled items", () => {
      const futureTime = Date.now() + 60 * 60 * 1000;
      mockQueue.set("g", makeItem({ id: "g", status: "scheduled", scheduledFor: futureTime }));
      const win = makeFakeWindow();

      reconcileOnStartup(win);

      expect(schedule.scheduleJob).toHaveBeenCalledOnce();
    });

    it("skips items that are already deleted", () => {
      mockQueue.set("h", makeItem({ id: "h", status: "deleted" }));
      const win = makeFakeWindow();

      reconcileOnStartup(win);

      expect(schedule.scheduleJob).not.toHaveBeenCalled();
    });

    it("skips items with null scheduledFor (never delete)", () => {
      mockQueue.set("i", makeItem({ id: "i", status: "pending", scheduledFor: null }));
      const win = makeFakeWindow();

      reconcileOnStartup(win);

      expect(schedule.scheduleJob).not.toHaveBeenCalled();
    });

    it("processes overdue items via setTimeout stagger", () => {
      vi.useFakeTimers();
      const pastTime = Date.now() - 60 * 1000;
      mockQueue.set("j", makeItem({ id: "j", status: "scheduled", scheduledFor: pastTime }));
      const win = makeFakeWindow();

      reconcileOnStartup(win);

      // Overdue items are handled via setTimeout, not scheduleJob
      expect(schedule.scheduleJob).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  // ── attemptDeletion (via job fire) ──────────────────────────────────────────

  describe("attemptDeletion (indirect via scheduleItem job)", () => {
    it("marks item deleted and emits file:deleted when file is gone (ENOENT)", async () => {
      fileExists = false;
      const item = makeItem({
        id: "k",
        status: "scheduled",
        scheduledFor: Date.now() + 1,
      });
      mockQueue.set("k", item);
      const win = makeFakeWindow();

      scheduleItem(item, 1 / 60, win); // 1 second

      // Manually fire the job callback
      const job = vi.mocked(schedule.scheduleJob).mock.results[0].value;
      await job.callback();

      expect(patchQueueItem).toHaveBeenCalledWith("k", { status: "deleted" });
      expect(win.webContents.send).toHaveBeenCalledWith("file:deleted", "k");
    });

    it("calls trash and marks deleted for an unlocked file", async () => {
      fileExists = true;
      fileLocked = false;
      const item = makeItem({ id: "l", status: "scheduled" });
      mockQueue.set("l", item);
      const win = makeFakeWindow();

      scheduleItem(item, 1 / 60, win);
      const job = vi.mocked(schedule.scheduleJob).mock.results[0].value;
      await job.callback();

      expect(vi.mocked(trashModule.default)).toHaveBeenCalledWith(item.filePath);
      expect(patchQueueItem).toHaveBeenCalledWith("l", { status: "deleted" });
      expect(win.webContents.send).toHaveBeenCalledWith("file:deleted", "l");
    });

    it("snoozes a locked file and increments snoozeCount", async () => {
      fileExists = true;
      fileLocked = true;
      const item = makeItem({ id: "m", status: "scheduled", snoozeCount: 0 });
      mockQueue.set("m", item);
      const win = makeFakeWindow();

      scheduleItem(item, 1 / 60, win);
      const job = vi.mocked(schedule.scheduleJob).mock.results[0].value;
      await job.callback();

      expect(vi.mocked(trashModule.default)).not.toHaveBeenCalled();
      expect(patchQueueItem).toHaveBeenCalledWith(
        "m",
        expect.objectContaining({
          status: "snoozed",
          snoozeCount: 1,
        }),
      );
      expect(win.webContents.send).toHaveBeenCalledWith("file:in-use", expect.anything());
    });

    it("marks failed after max snooze retries exceeded", async () => {
      fileExists = true;
      fileLocked = true;
      const item = makeItem({ id: "n", status: "snoozed", snoozeCount: 3 }); // already at max
      mockQueue.set("n", item);
      const win = makeFakeWindow();

      scheduleItem(item, 1 / 60, win);
      const job = vi.mocked(schedule.scheduleJob).mock.results[0].value;
      await job.callback();

      expect(patchQueueItem).toHaveBeenCalledWith(
        "n",
        expect.objectContaining({
          status: "failed",
        }),
      );
    });
  });

  // ── window-title heuristic ──────────────────────────────────────────────────

  describe("window-title heuristic", () => {
    it("proceeds to trash when no window title matches", async () => {
      fileExists = true;
      fileLocked = false;
      windowTitleProcesses = [];
      const item = makeItem({ id: "wt1", status: "scheduled" });
      mockQueue.set("wt1", item);
      const win = makeFakeWindow();

      scheduleItem(item, 1 / 60, win);
      const job = vi.mocked(schedule.scheduleJob).mock.results[0].value;
      await job.callback();

      expect(vi.mocked(trashModule.default)).toHaveBeenCalledWith(item.filePath);
      expect(patchQueueItem).toHaveBeenCalledWith("wt1", {
        status: "deleted",
      });
    });

    it("sets status to confirming and sends event when window title matches", async () => {
      fileExists = true;
      fileLocked = false;
      windowTitleProcesses = ["notepad"];
      const item = makeItem({ id: "wt2", status: "scheduled" });
      mockQueue.set("wt2", item);
      const win = makeFakeWindow();

      scheduleItem(item, 1 / 60, win);
      const job = vi.mocked(schedule.scheduleJob).mock.results[0].value;

      // Don't await — let the confirmation hang
      const deletionPromise = job.callback();

      // Should be in confirming state
      expect(patchQueueItem).toHaveBeenCalledWith("wt2", {
        status: "confirming",
      });
      expect(win.webContents.send).toHaveBeenCalledWith(
        "file:confirm-delete",
        expect.objectContaining({ processNames: ["notepad"] }),
      );

      // Resolve the confirmation externally
      resolveConfirmation("wt2", "delete");
      await deletionPromise;

      expect(vi.mocked(trashModule.default)).toHaveBeenCalled();
    });

    it("cancels timer when user chooses keep", async () => {
      fileExists = true;
      fileLocked = false;
      windowTitleProcesses = ["notepad"];
      const item = makeItem({ id: "wt3", status: "scheduled" });
      mockQueue.set("wt3", item);
      const win = makeFakeWindow();

      scheduleItem(item, 1 / 60, win);
      const job = vi.mocked(schedule.scheduleJob).mock.results[0].value;
      const deletionPromise = job.callback();

      resolveConfirmation("wt3", "keep");
      await deletionPromise;

      expect(vi.mocked(trashModule.default)).not.toHaveBeenCalled();
      expect(patchQueueItem).toHaveBeenCalledWith("wt3", {
        status: "pending",
        scheduledFor: null,
      });
    });

    it("auto-deletes after timeout when no user response", async () => {
      vi.useFakeTimers();
      fileExists = true;
      fileLocked = false;
      windowTitleProcesses = ["notepad"];
      const item = makeItem({ id: "wt4", status: "scheduled" });
      mockQueue.set("wt4", item);
      const win = makeFakeWindow();

      scheduleItem(item, 1 / 60, win);
      const job = vi.mocked(schedule.scheduleJob).mock.results[0].value;
      const deletionPromise = job.callback();

      // Advance past the confirmation timeout (15s)
      vi.advanceTimersByTime(15_000);
      await deletionPromise;

      expect(vi.mocked(trashModule.default)).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});
