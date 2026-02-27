import { useState, useMemo, useEffect, useRef } from "react";
import { type QueueItem, type QueueItemStatus } from "../../shared/types";
import { useQueueStore } from "../store/useQueueStore";
import { formatBytes, formatCountdown, middleTruncate } from "../utils/format";

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<QueueItemStatus, string> = {
  pending: "bg-neutral-700 text-neutral-300",
  scheduled: "bg-blue-900 text-blue-300",
  snoozed: "bg-amber-900 text-amber-300",
  confirming: "bg-yellow-900 text-yellow-300",
  deleting: "bg-orange-900 text-orange-300",
  deleted: "bg-neutral-800 text-neutral-500",
  failed: "bg-red-900 text-red-300",
  whitelisted: "bg-green-900 text-green-300",
};

const STATUS_LABELS: Record<QueueItemStatus, string> = {
  pending: "Pending",
  scheduled: "Scheduled",
  snoozed: "Snoozed",
  confirming: "Confirming…",
  deleting: "Deleting…",
  deleted: "Deleted",
  failed: "Failed",
  whitelisted: "Whitelisted",
};

function StatusBadge({ status }: { status: QueueItemStatus }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

// ─── Countdown cell ───────────────────────────────────────────────────────────

function CountdownCell({ item }: { item: QueueItem }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!item.scheduledFor || item.status === "deleted" || item.status === "failed") return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [item.scheduledFor, item.status]);

  if (item.status === "deleted") return <span className="text-neutral-600">—</span>;
  if (!item.scheduledFor) return <span className="text-neutral-500 text-xs">Never</span>;

  return <span className="tabular-nums">{formatCountdown(item.scheduledFor)}</span>;
}

// ─── Filter types ─────────────────────────────────────────────────────────────

type FilterStatus = "all" | "active" | "deleted";

const FILTER_OPTIONS: { label: string; value: FilterStatus }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Deleted", value: "deleted" },
];

type SortKey = "detectedAt" | "scheduledFor" | "fileName" | "fileSize";

const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: "Detected", value: "detectedAt" },
  { label: "Deletes at", value: "scheduledFor" },
  { label: "Name", value: "fileName" },
  { label: "Size", value: "fileSize" },
];

// ─── Row actions ──────────────────────────────────────────────────────────────

function RowActions({ item }: { item: QueueItem }) {
  const { updateItem, removeItem } = useQueueStore();

  function handleCancel() {
    window.tempdlm.cancelItem({ itemId: item.id });
    updateItem(item.id, { status: "pending", scheduledFor: null });
  }

  function handleSnooze() {
    window.tempdlm.snoozeItem({ itemId: item.id });
  }

  function handleRemove() {
    window.tempdlm.removeItem({ itemId: item.id });
    removeItem(item.id);
  }

  if (item.status === "deleting" || item.status === "whitelisted" || item.status === "confirming") {
    return null;
  }

  return (
    <div className="flex gap-2 justify-end">
      {(item.status === "scheduled" || item.status === "snoozed") && (
        <>
          <button
            onClick={handleSnooze}
            className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
            aria-label={`Snooze ${item.fileName}`}
          >
            Snooze
          </button>
          <button
            onClick={handleCancel}
            className="text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
            aria-label={`Cancel timer for ${item.fileName}`}
          >
            Cancel
          </button>
        </>
      )}
      {item.status === "failed" && (
        <span className="text-xs text-red-400 truncate max-w-[5rem]" title={item.error}>
          {item.error ?? "Unknown error"}
        </span>
      )}
      {(item.status === "deleted" || item.status === "failed") && (
        <button
          onClick={handleRemove}
          className="text-xs text-red-400 hover:text-red-300 transition-colors"
          aria-label={`Remove ${item.fileName} from queue`}
        >
          Remove
        </button>
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-20">
      <p className="text-neutral-500 text-sm">
        {filtered ? "No files match your search." : "No files in queue."}
      </p>
      {!filtered && (
        <p className="text-neutral-600 text-xs mt-1">
          Files will appear here when detected in your Downloads folder.
        </p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Displays and manages the list of files scheduled for deletion.
 * Supports searching, sorting, filtering, and cancelling individual items.
 * @returns The queue view element with virtual-scrolled file list.
 */
export default function QueueView() {
  const { items, isLoading, searchQuery, setSearchQuery, removeItem } = useQueueStore();

  function handleClearOld() {
    const old = items.filter((i) => i.status === "deleted" || i.status === "failed");
    old.forEach((i) => {
      window.tempdlm.removeItem({ itemId: i.id });
      removeItem(i.id);
    });
  }

  const hasOld = items.some((i) => i.status === "deleted" || i.status === "failed");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [sortKey, setSortKey] = useState<SortKey>("detectedAt");
  const searchRef = useRef<HTMLInputElement>(null);

  // Debounced search
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 150);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Filter + sort
  const filtered = useMemo(() => {
    let result = items;

    if (debouncedQuery) {
      const q = debouncedQuery.toLowerCase();
      result = result.filter((i) => i.fileName.toLowerCase().includes(q));
    }

    if (filterStatus === "active") {
      result = result.filter((i) => i.status !== "deleted" && i.status !== "failed");
    } else if (filterStatus === "deleted") {
      result = result.filter((i) => i.status === "deleted");
    }

    return [...result].sort((a, b) => {
      switch (sortKey) {
        case "detectedAt":
          return b.detectedAt - a.detectedAt;
        case "scheduledFor":
          return (a.scheduledFor ?? Infinity) - (b.scheduledFor ?? Infinity);
        case "fileName":
          return a.fileName.localeCompare(b.fileName);
        case "fileSize":
          return b.fileSize - a.fileSize;
      }
    });
  }, [items, debouncedQuery, filterStatus, sortKey]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-neutral-500 text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800">
        {/* Search */}
        <input
          ref={searchRef}
          type="search"
          placeholder="Search files…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search queue"
          className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
        />

        {/* Filter */}
        <div className="flex gap-1" role="group" aria-label="Filter by status">
          {FILTER_OPTIONS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setFilterStatus(value)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                filterStatus === value
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-800 text-neutral-400 hover:text-neutral-200"
              }`}
              aria-pressed={filterStatus === value}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          aria-label="Sort by"
          className="bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1.5 text-xs text-neutral-300 focus:outline-none focus:border-blue-500"
        >
          {SORT_OPTIONS.map(({ label, value }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        {/* Clear old */}
        {hasOld && (
          <button
            onClick={handleClearOld}
            className="px-3 py-1.5 text-xs rounded-lg bg-neutral-800 border border-neutral-700 text-red-400 hover:border-red-600 hover:text-red-300 transition-colors whitespace-nowrap"
            aria-label="Clear deleted and failed entries"
          >
            Clear old
          </button>
        )}
      </div>

      {/* Count */}
      <div className="px-4 py-2 text-xs text-neutral-600">
        {filtered.length} {filtered.length === 1 ? "file" : "files"}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState filtered={!!debouncedQuery || filterStatus !== "all"} />
      ) : (
        <div className="flex-1 overflow-y-auto" role="list" aria-label="File queue">
          {filtered.map((item) => (
            <div
              key={item.id}
              role="listitem"
              className="flex items-center gap-4 px-4 py-3 border-b border-neutral-800/50 hover:bg-neutral-800/30 transition-colors"
            >
              {/* File info */}
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm text-neutral-100 overflow-hidden whitespace-nowrap"
                  title={item.filePath}
                >
                  {middleTruncate(item.fileName)}
                </p>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {formatBytes(item.fileSize)}
                  {item.fileExtension && (
                    <span className="ml-2 uppercase text-neutral-600">
                      {item.fileExtension.replace(".", "")}
                    </span>
                  )}
                </p>
              </div>

              {/* Status */}
              <div className="shrink-0">
                <StatusBadge status={item.status} />
              </div>

              {/* Countdown */}
              <div className="shrink-0 w-20 text-right text-xs text-neutral-400">
                <CountdownCell item={item} />
              </div>

              {/* Actions */}
              <div className="shrink-0 w-32">
                <RowActions item={item} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
