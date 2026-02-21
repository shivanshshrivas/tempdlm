import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WhitelistRule } from "../../shared/types";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("electron", () => ({
  app: { getPath: () => "C:\\Users\\test\\Downloads" },
  Notification: class {
    static isSupported() {
      return false;
    }
    on() {
      return this;
    }
    show() {}
  },
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

// Mock store module so we can control getSettings and spy on upsertQueueItem
const mockSettings = {
  downloadsFolder: "C:\\Users\\test\\Downloads",
  launchAtStartup: false,
  defaultTimer: "30m" as const,
  customDefaultMinutes: 60,
  theme: "system" as const,
  showNotifications: true,
  dialogPosition: "bottom-right" as const,
  whitelistRules: [] as WhitelistRule[],
};

vi.mock("../store", () => ({
  getSettings: () => mockSettings,
  getQueue: () => [],
  upsertQueueItem: vi.fn(),
  patchQueueItem: vi.fn(),
  initStore: vi.fn(),
}));

// Mock fs so we don't touch the real filesystem
vi.mock("fs", () => ({
  default: {
    statSync: vi.fn(() => ({ size: 2048 })),
  },
}));

// Mock chokidar — we capture the 'add' handler and call it manually in tests
let capturedAddHandler: ((filePath: string) => void) | null = null;
const mockWatcherInstance = {
  on: vi.fn((event: string, handler: (fp: string) => void) => {
    if (event === "add") capturedAddHandler = handler;
    return mockWatcherInstance;
  }),
  close: vi.fn(),
};
vi.mock("chokidar", () => ({
  default: {
    watch: vi.fn(() => mockWatcherInstance),
  },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  matchWhitelistRule,
  buildQueueItem,
  startWatcher,
  stopWatcher,
  _getDebounceTimers,
} from "../fileWatcher";
import { upsertQueueItem } from "../store";
import fs from "fs";

// ─── Fake BrowserWindow ───────────────────────────────────────────────────────

function makeFakeWindow() {
  return {
    webContents: { send: vi.fn() },
    isVisible: vi.fn(() => true),
    show: vi.fn(),
    focus: vi.fn(),
  } as unknown as import("electron").BrowserWindow;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("matchWhitelistRule", () => {
  const rules: WhitelistRule[] = [
    {
      id: "1",
      type: "extension",
      value: ".pdf",
      action: "never-delete",
      enabled: true,
    },
    {
      id: "2",
      type: "extension",
      value: ".exe",
      action: "auto-delete-after",
      autoDeleteMinutes: 5,
      enabled: true,
    },
    {
      id: "3",
      type: "filename",
      value: "setup.msi",
      action: "never-delete",
      enabled: true,
    },
    {
      id: "4",
      type: "extension",
      value: ".tmp",
      action: "never-delete",
      enabled: false,
    }, // disabled
  ];

  it("matches extension rule (case-insensitive)", () => {
    expect(matchWhitelistRule("Report.PDF", rules)?.id).toBe("1");
  });

  it("matches filename rule", () => {
    expect(matchWhitelistRule("setup.msi", rules)?.id).toBe("3");
  });

  it("returns null when no rule matches", () => {
    expect(matchWhitelistRule("archive.zip", rules)).toBeNull();
  });

  it("ignores disabled rules", () => {
    expect(matchWhitelistRule("temp.tmp", rules)).toBeNull();
  });

  it("returns auto-delete rule for .exe", () => {
    const rule = matchWhitelistRule("installer.exe", rules);
    expect(rule?.action).toBe("auto-delete-after");
    expect(rule?.autoDeleteMinutes).toBe(5);
  });
});

describe("buildQueueItem", () => {
  it("builds a QueueItem from a real-looking path", () => {
    const item = buildQueueItem("C:\\Users\\test\\Downloads\\file.zip");
    expect(item).not.toBeNull();
    expect(item!.fileName).toBe("file.zip");
    expect(item!.fileExtension).toBe(".zip");
    expect(item!.fileSize).toBe(2048);
    expect(item!.status).toBe("pending");
    expect(item!.id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
  });

  it("returns null when statSync throws (file gone)", () => {
    vi.mocked(fs.statSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    expect(buildQueueItem("C:\\gone.zip")).toBeNull();
  });
});

describe("startWatcher / stopWatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedAddHandler = null;
    stopWatcher();
  });

  afterEach(() => {
    stopWatcher();
  });

  it("starts chokidar watcher on the downloads folder", async () => {
    const chokidar = (await import("chokidar")).default;
    const win = makeFakeWindow();
    startWatcher(win, mockSettings);
    expect(chokidar.watch).toHaveBeenCalledWith(
      mockSettings.downloadsFolder,
      expect.objectContaining({ ignoreInitial: true, depth: 0 }),
    );
  });

  it("debounces rapid add events for the same path — only one QueueItem created", async () => {
    vi.useFakeTimers();
    const win = makeFakeWindow();
    startWatcher(win, mockSettings);

    const filePath = "C:\\Users\\test\\Downloads\\file.zip";

    // Fire add event twice rapidly
    capturedAddHandler!(filePath);
    capturedAddHandler!(filePath);

    // Before debounce settles: no call yet
    expect(upsertQueueItem).not.toHaveBeenCalled();

    // Advance past debounce
    await vi.runAllTimersAsync();

    expect(upsertQueueItem).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("sends file:new IPC event to renderer for a normal file", async () => {
    vi.useFakeTimers();
    const win = makeFakeWindow();
    startWatcher(win, mockSettings);

    capturedAddHandler!("C:\\Users\\test\\Downloads\\photo.jpg");
    await vi.runAllTimersAsync();

    expect(win.webContents.send).toHaveBeenCalledWith(
      "file:new",
      expect.objectContaining({
        fileName: "photo.jpg",
        status: "pending",
      }),
    );
    vi.useRealTimers();
  });

  it("suppresses dialog and marks whitelisted for never-delete rule", async () => {
    vi.useFakeTimers();
    mockSettings.whitelistRules = [
      {
        id: "w1",
        type: "extension",
        value: ".pdf",
        action: "never-delete",
        enabled: true,
      },
    ];
    const win = makeFakeWindow();
    startWatcher(win, mockSettings);

    capturedAddHandler!("C:\\Users\\test\\Downloads\\report.pdf");
    await vi.runAllTimersAsync();

    expect(upsertQueueItem).toHaveBeenCalledWith(
      expect.objectContaining({ status: "whitelisted" }),
    );
    expect(win.webContents.send).not.toHaveBeenCalled();

    mockSettings.whitelistRules = [];
    vi.useRealTimers();
  });

  it("schedules auto-delete and sends file:new for auto-delete-after rule", async () => {
    vi.useFakeTimers();
    mockSettings.whitelistRules = [
      {
        id: "w2",
        type: "extension",
        value: ".tmp",
        action: "auto-delete-after",
        autoDeleteMinutes: 5,
        enabled: true,
      },
    ];
    const win = makeFakeWindow();
    startWatcher(win, mockSettings);

    capturedAddHandler!("C:\\Users\\test\\Downloads\\temp.tmp");
    await vi.runAllTimersAsync();

    expect(upsertQueueItem).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled" }));
    expect(win.webContents.send).toHaveBeenCalledWith(
      "file:new",
      expect.objectContaining({
        status: "scheduled",
      }),
    );

    mockSettings.whitelistRules = [];
    vi.useRealTimers();
  });

  it("stopWatcher clears debounce timers", async () => {
    vi.useFakeTimers();
    const win = makeFakeWindow();
    startWatcher(win, mockSettings);

    capturedAddHandler!("C:\\Users\\test\\Downloads\\file.zip");
    // Stop before debounce fires
    stopWatcher();

    await vi.runAllTimersAsync();
    // No item should be created since we stopped before the timer fired
    expect(upsertQueueItem).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
