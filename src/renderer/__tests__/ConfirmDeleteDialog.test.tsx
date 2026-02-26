// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfirmDeleteDialog from "../components/ConfirmDeleteDialog";
import { type ConfirmDeletePayload, type QueueItem } from "../../shared/types";

// ─── Mock window.tempdlm ─────────────────────────────────────────────────────

const mockConfirmDeleteResponse = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "tempdlm", {
    value: { confirmDeleteResponse: mockConfirmDeleteResponse },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "confirm-item-1",
    filePath: "C:\\Users\\test\\Downloads\\notes.txt",
    fileName: "notes.txt",
    fileSize: 1024,
    fileExtension: ".txt",
    inode: 0,
    detectedAt: Date.now(),
    scheduledFor: Date.now() + 60_000,
    status: "confirming",
    snoozeCount: 0,
    clusterId: null,
    ...overrides,
  };
}

function makePayload(overrides: Partial<ConfirmDeletePayload> = {}): ConfirmDeletePayload {
  return {
    item: makeItem(),
    processNames: ["notepad"],
    timeoutMs: 15_000,
    confirmationStartedAt: Date.now(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ConfirmDeleteDialog", () => {
  describe("rendering", () => {
    it("shows the file name", () => {
      render(<ConfirmDeleteDialog payload={makePayload()} onDismiss={vi.fn()} />);
      expect(screen.getByText("notes.txt")).toBeInTheDocument();
    });

    it("shows the process name", () => {
      render(<ConfirmDeleteDialog payload={makePayload()} onDismiss={vi.fn()} />);
      expect(screen.getByText("notepad")).toBeInTheDocument();
    });

    it("shows multiple process names joined by comma", () => {
      render(
        <ConfirmDeleteDialog
          payload={makePayload({ processNames: ["notepad", "code"] })}
          onDismiss={vi.fn()}
        />,
      );
      expect(screen.getByText("notepad, code")).toBeInTheDocument();
    });

    it("shows Keep file and Delete anyway buttons", () => {
      render(<ConfirmDeleteDialog payload={makePayload()} onDismiss={vi.fn()} />);
      expect(screen.getByText("Keep file")).toBeInTheDocument();
      expect(screen.getByText("Delete anyway")).toBeInTheDocument();
    });

    it("shows auto-delete countdown text", () => {
      render(<ConfirmDeleteDialog payload={makePayload()} onDismiss={vi.fn()} />);
      expect(screen.getByText(/Auto-deleting in/)).toBeInTheDocument();
    });
  });

  describe("user actions", () => {
    it("sends delete decision when Delete anyway is clicked", async () => {
      const onDismiss = vi.fn();
      render(<ConfirmDeleteDialog payload={makePayload()} onDismiss={onDismiss} />);

      await userEvent.click(screen.getByText("Delete anyway"));

      expect(mockConfirmDeleteResponse).toHaveBeenCalledWith({
        itemId: "confirm-item-1",
        decision: "delete",
      });
      expect(onDismiss).toHaveBeenCalled();
    });

    it("sends keep decision when Keep file is clicked", async () => {
      const onDismiss = vi.fn();
      render(<ConfirmDeleteDialog payload={makePayload()} onDismiss={onDismiss} />);

      await userEvent.click(screen.getByText("Keep file"));

      expect(mockConfirmDeleteResponse).toHaveBeenCalledWith({
        itemId: "confirm-item-1",
        decision: "keep",
      });
      expect(onDismiss).toHaveBeenCalled();
    });

    it("prevents double-submission on rapid clicks", async () => {
      const onDismiss = vi.fn();
      render(<ConfirmDeleteDialog payload={makePayload()} onDismiss={onDismiss} />);

      const deleteBtn = screen.getByText("Delete anyway");
      await userEvent.click(deleteBtn);
      await userEvent.click(deleteBtn);

      expect(mockConfirmDeleteResponse).toHaveBeenCalledTimes(1);
    });
  });

  describe("auto-delete timeout", () => {
    it("auto-deletes after timeout expires", () => {
      vi.useFakeTimers();
      const onDismiss = vi.fn();

      render(
        <ConfirmDeleteDialog payload={makePayload({ timeoutMs: 5_000 })} onDismiss={onDismiss} />,
      );

      expect(mockConfirmDeleteResponse).not.toHaveBeenCalled();

      // Advance past the timeout
      act(() => {
        vi.advanceTimersByTime(5_100);
      });

      expect(mockConfirmDeleteResponse).toHaveBeenCalledWith({
        itemId: "confirm-item-1",
        decision: "delete",
      });
      expect(onDismiss).toHaveBeenCalled();
    });

    it("does not auto-delete if user responds before timeout", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const onDismiss = vi.fn();

      render(
        <ConfirmDeleteDialog payload={makePayload({ timeoutMs: 15_000 })} onDismiss={onDismiss} />,
      );

      // User clicks Keep before timeout
      await userEvent.click(screen.getByText("Keep file"));

      expect(mockConfirmDeleteResponse).toHaveBeenCalledWith({
        itemId: "confirm-item-1",
        decision: "keep",
      });

      // Advance past timeout — should NOT send another response
      act(() => {
        vi.advanceTimersByTime(16_000);
      });

      expect(mockConfirmDeleteResponse).toHaveBeenCalledTimes(1);
    });
  });
});
