// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UpdateNotification from "../components/UpdateNotification";
import { AppUpdateInfo } from "../../shared/types";

// ─── Mock window.tempdlm ─────────────────────────────────────────────────────

type Callback = (...args: unknown[]) => void;

const listeners: Record<string, Callback> = {};

const mockDownloadUpdate = vi.fn().mockResolvedValue(undefined);
const mockInstallUpdate = vi.fn().mockResolvedValue(undefined);
const mockCheckForUpdate = vi.fn().mockResolvedValue(undefined);
const mockOpenExternal = vi.fn().mockResolvedValue(undefined);

function makeSubscriber(event: string) {
  return (cb: Callback) => {
    listeners[event] = cb;
    return () => {
      delete listeners[event];
    };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(listeners).forEach((k) => delete listeners[k]);

  Object.defineProperty(window, "tempdlm", {
    value: {
      onUpdateAvailable: makeSubscriber("update-available"),
      onUpdateProgress: makeSubscriber("update-progress"),
      onUpdateDownloaded: makeSubscriber("update-downloaded"),
      onUpdateError: makeSubscriber("update-error"),
      downloadUpdate: mockDownloadUpdate,
      installUpdate: mockInstallUpdate,
      checkForUpdate: mockCheckForUpdate,
      openExternal: mockOpenExternal,
    },
    writable: true,
    configurable: true,
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sampleInfo: AppUpdateInfo = {
  version: "1.2.0",
  releaseDate: "2026-02-20T12:00:00Z",
  releaseNotes: "## Changes\n\n- **Fixed** download clustering bug\n- Added dark mode support",
  releaseNotesUrl: "https://github.com/shivanshshrivas/tempdlm/releases/tag/v1.2.0",
};

function triggerUpdateAvailable(info: AppUpdateInfo = sampleInfo) {
  listeners["update-available"]?.(info);
}

function triggerDownloadProgress(percent: number) {
  listeners["update-progress"]?.({
    percent,
    bytesPerSecond: 1_000_000,
    transferred: percent * 1000,
    total: 100_000,
  });
}

function triggerUpdateDownloaded() {
  listeners["update-downloaded"]?.();
}

function triggerUpdateError(message: string) {
  listeners["update-error"]?.(message);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("UpdateNotification", () => {
  describe("idle state", () => {
    it("renders nothing when no update is available", () => {
      const { container } = render(<UpdateNotification />);
      expect(container.querySelector("[role='dialog']")).toBeNull();
    });
  });

  describe("update available", () => {
    it("shows notification when update is available", async () => {
      render(<UpdateNotification />);
      triggerUpdateAvailable();
      await waitFor(() => {
        expect(screen.getByText("Update Available")).toBeInTheDocument();
      });
    });

    it("displays the version number", async () => {
      render(<UpdateNotification />);
      triggerUpdateAvailable();
      await waitFor(() => {
        expect(screen.getByText("v1.2.0")).toBeInTheDocument();
      });
    });

    it("displays formatted release date", async () => {
      render(<UpdateNotification />);
      triggerUpdateAvailable();
      await waitFor(() => {
        // The exact format depends on locale; check that the year appears
        expect(screen.getByText(/2026/)).toBeInTheDocument();
      });
    });

    it("displays a summary of release notes", async () => {
      render(<UpdateNotification />);
      triggerUpdateAvailable();
      await waitFor(() => {
        expect(screen.getByText(/download clustering bug/)).toBeInTheDocument();
      });
    });

    it("shows 'View full release notes' link", async () => {
      render(<UpdateNotification />);
      triggerUpdateAvailable();
      await waitFor(() => {
        expect(screen.getByText("View full release notes")).toBeInTheDocument();
      });
    });

    it("opens external URL when clicking release notes link", async () => {
      render(<UpdateNotification />);
      triggerUpdateAvailable();
      await waitFor(() => screen.getByText("View full release notes"));
      await userEvent.click(screen.getByText("View full release notes"));
      expect(mockOpenExternal).toHaveBeenCalledWith(sampleInfo.releaseNotesUrl);
    });

    it("shows Download & Install button", async () => {
      render(<UpdateNotification />);
      triggerUpdateAvailable();
      await waitFor(() => {
        expect(screen.getByText("Download & Install")).toBeInTheDocument();
      });
    });

    it("triggers download when Download & Install is clicked", async () => {
      render(<UpdateNotification />);
      triggerUpdateAvailable();
      await waitFor(() => screen.getByText("Download & Install"));
      await userEvent.click(screen.getByText("Download & Install"));
      expect(mockDownloadUpdate).toHaveBeenCalled();
    });
  });

  describe("downloading", () => {
    it("shows download progress", async () => {
      render(<UpdateNotification />);
      triggerUpdateAvailable();
      await waitFor(() => screen.getByText("Download & Install"));
      triggerDownloadProgress(45);
      await waitFor(() => {
        expect(screen.getByText("Downloading update…")).toBeInTheDocument();
        expect(screen.getByText("45%")).toBeInTheDocument();
      });
    });
  });

  describe("downloaded", () => {
    it("shows Restart Now and Later buttons after download completes", async () => {
      render(<UpdateNotification />);
      triggerUpdateAvailable();
      await waitFor(() => screen.getByText("Update Available"));
      triggerUpdateDownloaded();
      await waitFor(() => {
        expect(screen.getByText("Restart Now")).toBeInTheDocument();
        expect(screen.getByText("Later")).toBeInTheDocument();
      });
    });

    it("calls installUpdate when Restart Now is clicked", async () => {
      render(<UpdateNotification />);
      triggerUpdateAvailable();
      await waitFor(() => screen.getByText("Update Available"));
      triggerUpdateDownloaded();
      await waitFor(() => screen.getByText("Restart Now"));
      await userEvent.click(screen.getByText("Restart Now"));
      expect(mockInstallUpdate).toHaveBeenCalled();
    });

    it("dismisses notification when Later is clicked", async () => {
      render(<UpdateNotification />);
      triggerUpdateAvailable();
      await waitFor(() => screen.getByText("Update Available"));
      triggerUpdateDownloaded();
      await waitFor(() => screen.getByText("Later"));
      await userEvent.click(screen.getByText("Later"));
      await waitFor(() => {
        expect(screen.queryByText("Restart Now")).not.toBeInTheDocument();
      });
    });
  });

  describe("error", () => {
    it("shows error message", async () => {
      render(<UpdateNotification />);
      triggerUpdateAvailable();
      await waitFor(() => screen.getByText("Update Available"));
      triggerUpdateError("Network error");
      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("Network error");
      });
    });

    it("shows Retry button on error", async () => {
      render(<UpdateNotification />);
      triggerUpdateAvailable();
      await waitFor(() => screen.getByText("Update Available"));
      triggerUpdateError("Network error");
      await waitFor(() => {
        expect(screen.getByText("Retry")).toBeInTheDocument();
      });
    });

    it("calls checkForUpdate when Retry is clicked", async () => {
      render(<UpdateNotification />);
      triggerUpdateAvailable();
      await waitFor(() => screen.getByText("Update Available"));
      triggerUpdateError("Network error");
      await waitFor(() => screen.getByText("Retry"));
      await userEvent.click(screen.getByText("Retry"));
      expect(mockCheckForUpdate).toHaveBeenCalled();
    });
  });

  describe("dismiss", () => {
    it("hides notification when dismiss button is clicked", async () => {
      render(<UpdateNotification />);
      triggerUpdateAvailable();
      await waitFor(() => screen.getByLabelText("Dismiss update notification"));
      await userEvent.click(screen.getByLabelText("Dismiss update notification"));
      await waitFor(() => {
        expect(screen.queryByText("Update Available")).not.toBeInTheDocument();
      });
    });

    it("reappears when a new update event fires after dismissal", async () => {
      render(<UpdateNotification />);
      triggerUpdateAvailable();
      await waitFor(() => screen.getByLabelText("Dismiss update notification"));
      await userEvent.click(screen.getByLabelText("Dismiss update notification"));
      await waitFor(() => {
        expect(screen.queryByText("Update Available")).not.toBeInTheDocument();
      });
      triggerUpdateAvailable({ ...sampleInfo, version: "1.3.0" });
      await waitFor(() => {
        expect(screen.getByText("Update Available")).toBeInTheDocument();
        expect(screen.getByText("v1.3.0")).toBeInTheDocument();
      });
    });
  });
});
