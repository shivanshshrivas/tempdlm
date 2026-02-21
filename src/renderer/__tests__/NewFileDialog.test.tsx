// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewFileDialog from "../components/NewFileDialog";
import { QueueItem } from "../../shared/types";

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
  });
});
