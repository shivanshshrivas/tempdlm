// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QueueView from "../components/QueueView";
import { useQueueStore } from "../store/useQueueStore";
import { type QueueItem } from "../../shared/types";

// ─── Mock window.tempdlm ─────────────────────────────────────────────────────

const mockCancelItem = vi.fn().mockResolvedValue(undefined);
const mockSnoozeItem = vi.fn().mockResolvedValue(undefined);
const mockRemoveItem = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "tempdlm", {
    value: { cancelItem: mockCancelItem, snoozeItem: mockSnoozeItem, removeItem: mockRemoveItem },
    writable: true,
    configurable: true,
  });
  // Reset store to empty + loaded state
  useQueueStore.setState({ items: [], isLoading: false, searchQuery: "" });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _id = 0;
function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  _id++;
  return {
    id: `item-${_id}`,
    filePath: `C:\\Downloads\\file${_id}.zip`,
    fileName: `file${_id}.zip`,
    fileSize: 1024 * _id,
    fileExtension: ".zip",
    inode: _id,
    detectedAt: Date.now() - _id * 1000,
    scheduledFor: null,
    status: "pending",
    snoozeCount: 0,
    clusterId: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("QueueView", () => {
  describe("empty state", () => {
    it("shows empty state when queue is empty", () => {
      render(<QueueView />);
      expect(screen.getByText("No files in queue.")).toBeInTheDocument();
    });

    it("shows loading state", () => {
      useQueueStore.setState({ isLoading: true });
      render(<QueueView />);
      expect(screen.getByText("Loading…")).toBeInTheDocument();
    });
  });

  describe("rendering items", () => {
    it("renders file names", () => {
      useQueueStore.setState({
        items: [makeItem({ fileName: "report.pdf" }), makeItem({ fileName: "image.jpg" })],
      });
      render(<QueueView />);
      expect(screen.getByText("report.pdf")).toBeInTheDocument();
      expect(screen.getByText("image.jpg")).toBeInTheDocument();
    });

    it("renders file sizes", () => {
      useQueueStore.setState({ items: [makeItem({ fileSize: 2048 })] });
      render(<QueueView />);
      expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    });

    it("renders status badge", () => {
      useQueueStore.setState({ items: [makeItem({ status: "scheduled" })] });
      render(<QueueView />);
      expect(screen.getByText("Scheduled")).toBeInTheDocument();
    });

    it("shows item count", () => {
      useQueueStore.setState({ items: [makeItem(), makeItem()] });
      render(<QueueView />);
      expect(screen.getByText("2 files")).toBeInTheDocument();
    });

    it('shows singular "file" for one item', () => {
      useQueueStore.setState({ items: [makeItem()] });
      render(<QueueView />);
      expect(screen.getByText("1 file")).toBeInTheDocument();
    });
  });

  describe("search", () => {
    it("filters items by file name", async () => {
      useQueueStore.setState({
        items: [makeItem({ fileName: "report.pdf" }), makeItem({ fileName: "photo.jpg" })],
      });
      render(<QueueView />);
      await userEvent.type(screen.getByLabelText("Search queue"), "report");
      await waitFor(() => {
        expect(screen.getByText("report.pdf")).toBeInTheDocument();
        expect(screen.queryByText("photo.jpg")).not.toBeInTheDocument();
      });
    });

    it("shows filtered empty state when no matches", async () => {
      useQueueStore.setState({ items: [makeItem({ fileName: "report.pdf" })] });
      render(<QueueView />);
      await userEvent.type(screen.getByLabelText("Search queue"), "xyz");
      await waitFor(() =>
        expect(screen.getByText("No files match your search.")).toBeInTheDocument(),
      );
    });

    it("is case-insensitive", async () => {
      useQueueStore.setState({ items: [makeItem({ fileName: "REPORT.PDF" })] });
      render(<QueueView />);
      await userEvent.type(screen.getByLabelText("Search queue"), "report");
      await waitFor(() => expect(screen.getByText("REPORT.PDF")).toBeInTheDocument());
    });
  });

  describe("status filter", () => {
    it("filters to active items only", async () => {
      useQueueStore.setState({
        items: [
          makeItem({ fileName: "active.zip", status: "scheduled" }),
          makeItem({ fileName: "gone.zip", status: "deleted" }),
        ],
      });
      render(<QueueView />);
      await userEvent.click(screen.getByRole("button", { name: "Active" }));
      expect(screen.getByText("active.zip")).toBeInTheDocument();
      expect(screen.queryByText("gone.zip")).not.toBeInTheDocument();
    });

    it("filters to deleted items only", async () => {
      useQueueStore.setState({
        items: [
          makeItem({ fileName: "active.zip", status: "scheduled" }),
          makeItem({ fileName: "gone.zip", status: "deleted" }),
        ],
      });
      render(<QueueView />);
      await userEvent.click(screen.getByRole("button", { name: "Deleted" }));
      expect(screen.queryByText("active.zip")).not.toBeInTheDocument();
      expect(screen.getByText("gone.zip")).toBeInTheDocument();
    });
  });

  describe("row actions", () => {
    it("shows Cancel and Snooze for scheduled items", () => {
      useQueueStore.setState({
        items: [
          makeItem({
            fileName: "test.zip",
            status: "scheduled",
            scheduledFor: Date.now() + 60000,
          }),
        ],
      });
      render(<QueueView />);
      expect(screen.getByLabelText("Cancel timer for test.zip")).toBeInTheDocument();
      expect(screen.getByLabelText("Snooze test.zip")).toBeInTheDocument();
    });

    it("calls cancelItem when Cancel is clicked", async () => {
      const item = makeItem({
        status: "scheduled",
        scheduledFor: Date.now() + 60000,
      });
      useQueueStore.setState({ items: [item] });
      render(<QueueView />);
      await userEvent.click(screen.getByLabelText(`Cancel timer for ${item.fileName}`));
      expect(mockCancelItem).toHaveBeenCalledWith({ itemId: item.id });
    });

    it("calls snoozeItem when Snooze is clicked", async () => {
      const item = makeItem({
        status: "scheduled",
        scheduledFor: Date.now() + 60000,
      });
      useQueueStore.setState({ items: [item] });
      render(<QueueView />);
      await userEvent.click(screen.getByLabelText(`Snooze ${item.fileName}`));
      expect(mockSnoozeItem).toHaveBeenCalledWith({ itemId: item.id });
    });

    it("shows no actions for deleted items", () => {
      const item = makeItem({ fileName: "gone.zip", status: "deleted" });
      useQueueStore.setState({ items: [item] });
      render(<QueueView />);
      expect(screen.queryByLabelText(`Cancel timer for gone.zip`)).not.toBeInTheDocument();
    });

    it("shows Remove button for deleted items", () => {
      const item = makeItem({ fileName: "gone.zip", status: "deleted" });
      useQueueStore.setState({ items: [item] });
      render(<QueueView />);
      expect(screen.getByLabelText("Remove gone.zip from queue")).toBeInTheDocument();
    });

    it("shows Remove button for failed items", () => {
      const item = makeItem({ fileName: "broken.zip", status: "failed", error: "disk full" });
      useQueueStore.setState({ items: [item] });
      render(<QueueView />);
      expect(screen.getByLabelText("Remove broken.zip from queue")).toBeInTheDocument();
    });

    it("calls removeItem when Remove is clicked", async () => {
      const item = makeItem({ fileName: "gone.zip", status: "deleted" });
      useQueueStore.setState({ items: [item] });
      render(<QueueView />);
      await userEvent.click(screen.getByLabelText("Remove gone.zip from queue"));
      expect(mockRemoveItem).toHaveBeenCalledWith({ itemId: item.id });
    });
  });

  describe("Clear old button", () => {
    it("shows Clear old button when deleted items exist", () => {
      useQueueStore.setState({ items: [makeItem({ status: "deleted" })] });
      render(<QueueView />);
      expect(screen.getByLabelText("Clear deleted and failed entries")).toBeInTheDocument();
    });

    it("shows Clear old button when failed items exist", () => {
      useQueueStore.setState({ items: [makeItem({ status: "failed" })] });
      render(<QueueView />);
      expect(screen.getByLabelText("Clear deleted and failed entries")).toBeInTheDocument();
    });

    it("hides Clear old button when no old items exist", () => {
      useQueueStore.setState({ items: [makeItem({ status: "scheduled" })] });
      render(<QueueView />);
      expect(screen.queryByLabelText("Clear deleted and failed entries")).not.toBeInTheDocument();
    });

    it("calls removeItem for each old item when Clear old is clicked", async () => {
      const deleted = makeItem({ status: "deleted" });
      const failed = makeItem({ status: "failed" });
      const active = makeItem({ status: "scheduled" });
      useQueueStore.setState({ items: [deleted, failed, active] });
      render(<QueueView />);
      await userEvent.click(screen.getByLabelText("Clear deleted and failed entries"));
      expect(mockRemoveItem).toHaveBeenCalledTimes(2);
      expect(mockRemoveItem).toHaveBeenCalledWith({ itemId: deleted.id });
      expect(mockRemoveItem).toHaveBeenCalledWith({ itemId: failed.id });
      // Active item must not be removed
      expect(mockRemoveItem).not.toHaveBeenCalledWith({ itemId: active.id });
    });
  });
});
