import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BrowserWindow } from "electron";
import { IPC_EVENTS, IPC_INVOKE } from "../../shared/types";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const {
  ipcHandlers,
  updaterListeners,
  mockCheckForUpdates,
  mockDownloadUpdate,
  mockOpenExternal,
  mockAutoUpdater,
  mockLogger,
} = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const updaterListeners = new Map<string, (...args: unknown[]) => void>();
  const mockCheckForUpdates = vi.fn();
  const mockDownloadUpdate = vi.fn();
  const mockQuitAndInstall = vi.fn();
  const mockOpenExternal = vi.fn();
  const mockAutoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      updaterListeners.set(event, callback);
      return mockAutoUpdater;
    }),
    checkForUpdates: mockCheckForUpdates,
    downloadUpdate: mockDownloadUpdate,
    quitAndInstall: mockQuitAndInstall,
  };
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    ipcHandlers,
    updaterListeners,
    mockCheckForUpdates,
    mockDownloadUpdate,
    mockOpenExternal,
    mockAutoUpdater,
    mockLogger,
  };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler);
    }),
  },
  shell: {
    openExternal: mockOpenExternal,
  },
}));

vi.mock("electron-updater", () => ({
  autoUpdater: mockAutoUpdater,
}));

vi.mock("../logger", () => ({
  default: mockLogger,
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { initUpdater, registerUpdateHandlers, checkForUpdatesNow, stopUpdater } from "../updater";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFakeWindow() {
  return {
    webContents: {
      send: vi.fn(),
    },
  } as unknown as BrowserWindow;
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("updater", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ipcHandlers.clear();
    updaterListeners.clear();
    mockCheckForUpdates.mockResolvedValue(undefined);
    mockDownloadUpdate.mockResolvedValue(undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopUpdater();
    vi.useRealTimers();
  });

  it("logs scheduled and periodic check failures", async () => {
    mockCheckForUpdates.mockRejectedValue(new Error("offline"));
    initUpdater(makeFakeWindow());

    vi.advanceTimersByTime(10_000);
    await flushAsync();
    expect(mockLogger.warn).toHaveBeenCalledWith("[updater] scheduled update check failed");

    vi.advanceTimersByTime(6 * 60 * 60 * 1_000);
    await flushAsync();
    expect(mockLogger.warn).toHaveBeenCalledWith("[updater] periodic update check failed");
  });

  it("logs update availability and forwards event payload", () => {
    const win = makeFakeWindow();
    initUpdater(win);

    const listener = updaterListeners.get("update-available");
    expect(listener).toBeDefined();

    listener?.({
      version: "1.2.3",
      releaseDate: "2026-03-01T00:00:00.000Z",
      releaseNotes: "Patch notes",
    });

    expect(mockLogger.info).toHaveBeenCalledWith("[updater] update available", {
      version: "1.2.3",
    });
    expect(win.webContents.send).toHaveBeenCalledWith(
      IPC_EVENTS.UPDATE_AVAILABLE,
      expect.objectContaining({ version: "1.2.3" }),
    );
  });

  it("logs manual update check failures from IPC handler", async () => {
    registerUpdateHandlers();
    mockCheckForUpdates.mockRejectedValueOnce(new Error("network"));

    const handler = ipcHandlers.get(IPC_INVOKE.UPDATE_CHECK);
    expect(handler).toBeDefined();

    const result = await handler?.({});
    expect(result).toEqual({ success: false, error: "network" });
    expect(mockLogger.warn).toHaveBeenCalledWith("[updater] manual update check failed", {
      error: "network",
    });
  });

  it("blocks non-allowlisted external URLs and logs warning", () => {
    registerUpdateHandlers();

    const handler = ipcHandlers.get(IPC_INVOKE.OPEN_EXTERNAL);
    expect(handler).toBeDefined();

    const result = handler?.({}, "https://example.com");
    expect(result).toEqual({ success: true });
    expect(mockOpenExternal).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith("[updater] blocked non-allowlisted external URL");
  });

  it("logs tray update check failures", async () => {
    mockCheckForUpdates.mockRejectedValueOnce(new Error("offline"));

    checkForUpdatesNow();
    await flushAsync();

    expect(mockLogger.warn).toHaveBeenCalledWith("[updater] tray update check failed");
  });
});
