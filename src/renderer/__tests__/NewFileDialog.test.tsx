// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewFileDialog from "../components/NewFileDialog";
import { type QueueItem } from "../../shared/types";

// ─── Mock window.tempdlm ─────────────────────────────────────────────────────

const mockSetTimer = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "tempdlm", {
    value: { setTimer: mockSetTimer },
    writable: true,
    configurable: true,
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "test-item-1",
    filePath: "C:\\Users\\test\\Downloads\\report.pdf",
    fileName: "report.pdf",
    fileSize: 204_800, // 200 KB
    fileExtension: ".pdf",
    inode: 0,
    detectedAt: Date.now(),
    scheduledFor: null,
    status: "pending",
    snoozeCount: 0,
    clusterId: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("NewFileDialog", () => {
  describe("rendering", () => {
    it("shows the file name", () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      expect(screen.getByText("report.pdf")).toBeInTheDocument();
    });

    it("shows the file size", () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      expect(screen.getByText("200.0 KB")).toBeInTheDocument();
    });

    it("shows all preset buttons", () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      expect(screen.getByText("5 min")).toBeInTheDocument();
      expect(screen.getByText("30 min")).toBeInTheDocument();
      expect(screen.getByText("2 hours")).toBeInTheDocument();
      expect(screen.getByText("1 day")).toBeInTheDocument();
    });

    it("shows Never and Custom buttons", () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      expect(screen.getByText("Never")).toBeInTheDocument();
      expect(screen.getByText("Custom…")).toBeInTheDocument();
    });

    it("does not show custom input panel initially", () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      expect(screen.queryByLabelText("Custom duration amount")).not.toBeInTheDocument();
    });
  });

  describe("preset buttons", () => {
    it("clicking 5 min calls setTimer with 5 minutes", async () => {
      const onDismiss = vi.fn();
      render(<NewFileDialog item={makeItem()} onDismiss={onDismiss} />);
      await userEvent.click(screen.getByText("5 min"));
      expect(mockSetTimer).toHaveBeenCalledWith({
        itemId: "test-item-1",
        minutes: 5,
      });
      expect(onDismiss).toHaveBeenCalled();
    });

    it("clicking 30 min calls setTimer with 30 minutes", async () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      await userEvent.click(screen.getByText("30 min"));
      expect(mockSetTimer).toHaveBeenCalledWith({
        itemId: "test-item-1",
        minutes: 30,
      });
    });

    it("clicking 2 hours calls setTimer with 120 minutes", async () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      await userEvent.click(screen.getByText("2 hours"));
      expect(mockSetTimer).toHaveBeenCalledWith({
        itemId: "test-item-1",
        minutes: 120,
      });
    });

    it("clicking 1 day calls setTimer with 1440 minutes", async () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      await userEvent.click(screen.getByText("1 day"));
      expect(mockSetTimer).toHaveBeenCalledWith({
        itemId: "test-item-1",
        minutes: 1440,
      });
    });
  });

  describe("keyboard shortcuts", () => {
    it.each([
      { key: "1", minutes: 5 },
      { key: "2", minutes: 30 },
      { key: "3", minutes: 120 },
      { key: "4", minutes: 1440 },
    ])("pressing $key sets a $minutes-minute preset", async ({ key, minutes }) => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      fireEvent.keyDown(window, { key });
      await waitFor(() =>
        expect(mockSetTimer).toHaveBeenCalledWith({
          itemId: "test-item-1",
          minutes,
        }),
      );
    });

    it("pressing N sets timer to Never", async () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      fireEvent.keyDown(window, { key: "n" });
      await waitFor(() =>
        expect(mockSetTimer).toHaveBeenCalledWith({
          itemId: "test-item-1",
          minutes: null,
        }),
      );
    });

    it("pressing C opens and focuses custom amount input", async () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      fireEvent.keyDown(window, { key: "c" });
      const amountInput = await screen.findByLabelText("Custom duration amount");
      await waitFor(() => expect(amountInput).toHaveFocus());
    });

    it("pressing Enter submits custom timer when custom panel is visible", async () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      await userEvent.click(screen.getByText("Custom…"));
      await userEvent.type(screen.getByLabelText("Custom duration amount"), "25");
      fireEvent.keyDown(window, { key: "Enter" });
      await waitFor(() =>
        expect(mockSetTimer).toHaveBeenCalledWith({
          itemId: "test-item-1",
          minutes: 25,
        }),
      );
    });

    it("pressing Escape dismisses the dialog", () => {
      const onDismiss = vi.fn();
      render(<NewFileDialog item={makeItem()} onDismiss={onDismiss} />);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(mockSetTimer).not.toHaveBeenCalled();
    });

    it("ignores preset shortcuts while typing in custom input", async () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      await userEvent.click(screen.getByText("Custom…"));
      const amountInput = screen.getByLabelText("Custom duration amount");
      amountInput.focus();
      fireEvent.keyDown(amountInput, { key: "1" });
      expect(mockSetTimer).not.toHaveBeenCalled();
    });
  });

  describe("Never button", () => {
    it("calls setTimer with null and dismisses", async () => {
      const onDismiss = vi.fn();
      render(<NewFileDialog item={makeItem()} onDismiss={onDismiss} />);
      await userEvent.click(screen.getByText("Never"));
      expect(mockSetTimer).toHaveBeenCalledWith({
        itemId: "test-item-1",
        minutes: null,
      });
      expect(onDismiss).toHaveBeenCalled();
    });
  });

  describe("dismiss button", () => {
    it("calls onDismiss without setting a timer", async () => {
      const onDismiss = vi.fn();
      render(<NewFileDialog item={makeItem()} onDismiss={onDismiss} />);
      await userEvent.click(screen.getByLabelText("Dismiss"));
      expect(onDismiss).toHaveBeenCalled();
      expect(mockSetTimer).not.toHaveBeenCalled();
    });
  });

  describe("custom input", () => {
    it("shows custom panel when Custom… is clicked", async () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      await userEvent.click(screen.getByText("Custom…"));
      expect(screen.getByLabelText("Custom duration amount")).toBeInTheDocument();
    });

    it("submits correct minutes for minutes unit", async () => {
      const onDismiss = vi.fn();
      render(<NewFileDialog item={makeItem()} onDismiss={onDismiss} />);
      await userEvent.click(screen.getByText("Custom…"));
      await userEvent.type(screen.getByLabelText("Custom duration amount"), "45");
      await userEvent.click(screen.getByText("Set timer"));
      expect(mockSetTimer).toHaveBeenCalledWith({
        itemId: "test-item-1",
        minutes: 45,
      });
      expect(onDismiss).toHaveBeenCalled();
    });

    it("submits correct minutes for hours unit", async () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      await userEvent.click(screen.getByText("Custom…"));
      await userEvent.selectOptions(screen.getByLabelText("Custom duration unit"), "hours");
      await userEvent.type(screen.getByLabelText("Custom duration amount"), "3");
      await userEvent.click(screen.getByText("Set timer"));
      expect(mockSetTimer).toHaveBeenCalledWith({
        itemId: "test-item-1",
        minutes: 180,
      });
    });

    it("submits correct minutes for days unit", async () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      await userEvent.click(screen.getByText("Custom…"));
      await userEvent.selectOptions(screen.getByLabelText("Custom duration unit"), "days");
      await userEvent.type(screen.getByLabelText("Custom duration amount"), "2");
      await userEvent.click(screen.getByText("Set timer"));
      expect(mockSetTimer).toHaveBeenCalledWith({
        itemId: "test-item-1",
        minutes: 2880,
      });
    });

    it("shows error for empty input", async () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      await userEvent.click(screen.getByText("Custom…"));
      await userEvent.click(screen.getByText("Set timer"));
      expect(screen.getByRole("alert")).toHaveTextContent("Enter a positive number");
      expect(mockSetTimer).not.toHaveBeenCalled();
    });

    it("shows error for zero input", async () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      await userEvent.click(screen.getByText("Custom…"));
      await userEvent.type(screen.getByLabelText("Custom duration amount"), "0");
      await userEvent.click(screen.getByText("Set timer"));
      expect(screen.getByRole("alert")).toHaveTextContent("Enter a positive number");
    });

    it("clears error when input changes", async () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      await userEvent.click(screen.getByText("Custom…"));
      await userEvent.click(screen.getByText("Set timer")); // trigger error
      expect(screen.getByRole("alert")).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText("Custom duration amount"), "5");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("rejects a custom timer above 28 days (40320 minutes)", async () => {
      render(<NewFileDialog item={makeItem()} onDismiss={vi.fn()} />);
      await userEvent.click(screen.getByText("Custom…"));
      await userEvent.selectOptions(screen.getByLabelText("Custom duration unit"), "days");
      await userEvent.type(screen.getByLabelText("Custom duration amount"), "29");
      await userEvent.click(screen.getByText("Set timer"));
      expect(screen.getByRole("alert")).toHaveTextContent("Maximum is 28 days");
      expect(mockSetTimer).not.toHaveBeenCalled();
    });

    it("accepts exactly 28 days (40320 minutes)", async () => {
      const onDismiss = vi.fn();
      render(<NewFileDialog item={makeItem()} onDismiss={onDismiss} />);
      await userEvent.click(screen.getByText("Custom…"));
      await userEvent.selectOptions(screen.getByLabelText("Custom duration unit"), "days");
      await userEvent.type(screen.getByLabelText("Custom duration amount"), "28");
      await userEvent.click(screen.getByText("Set timer"));
      expect(mockSetTimer).toHaveBeenCalledWith({
        itemId: "test-item-1",
        minutes: 40320,
      });
      expect(onDismiss).toHaveBeenCalled();
    });
  });

  describe("IPC error handling", () => {
    it("shows error and does not dismiss when setTimer rejects on preset click", async () => {
      mockSetTimer.mockRejectedValueOnce(new Error("Operation already in progress"));
      const onDismiss = vi.fn();
      render(<NewFileDialog item={makeItem()} onDismiss={onDismiss} />);
      await userEvent.click(screen.getByText("5 min"));
      expect(await screen.findByRole("alert")).toHaveTextContent("Operation already in progress");
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it("shows error and does not dismiss when Never rejects", async () => {
      mockSetTimer.mockRejectedValueOnce(new Error("Item not found"));
      const onDismiss = vi.fn();
      render(<NewFileDialog item={makeItem()} onDismiss={onDismiss} />);
      await userEvent.click(screen.getByText("Never"));
      expect(await screen.findByRole("alert")).toHaveTextContent("Item not found");
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it("shows error and does not dismiss when custom submit rejects", async () => {
      mockSetTimer.mockRejectedValueOnce(new Error("Window not available"));
      const onDismiss = vi.fn();
      render(<NewFileDialog item={makeItem()} onDismiss={onDismiss} />);
      await userEvent.click(screen.getByText("Custom…"));
      await userEvent.type(screen.getByLabelText("Custom duration amount"), "10");
      await userEvent.click(screen.getByText("Set timer"));
      expect(await screen.findByRole("alert")).toHaveTextContent("Window not available");
      expect(onDismiss).not.toHaveBeenCalled();
    });
  });
});
