import { useCallback, useEffect, useRef, useState } from "react";
import { type QueueItem } from "../../shared/types";
import { formatBytes, middleTruncate } from "../utils/format";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  item: QueueItem;
  onDismiss: () => void;
}

type Preset = "5m" | "30m" | "2h" | "1d";

const PRESETS: { label: string; value: Preset; minutes: number }[] = [
  { label: "5 min", value: "5m", minutes: 5 },
  { label: "30 min", value: "30m", minutes: 30 },
  { label: "2 hours", value: "2h", minutes: 120 },
  { label: "1 day", value: "1d", minutes: 1440 },
];

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Dialog shown when a new file is detected in the Downloads folder.
 * Lets the user pick a deletion timer preset or enter a custom duration.
 * @param props - Component props (see Props interface).
 * @returns The timer-selection dialog element.
 */
export default function NewFileDialog({ item, onDismiss }: Props) {
  const [showCustom, setShowCustom] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [customUnit, setCustomUnit] = useState<"minutes" | "hours" | "days">("minutes");
  const [customError, setCustomError] = useState("");
  const [ipcError, setIpcError] = useState("");
  const customAmountInputRef = useRef<HTMLInputElement>(null);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handlePreset = useCallback(
    async (minutes: number) => {
      try {
        await window.tempdlm.setTimer({ itemId: item.id, minutes });
        onDismiss();
      } catch (err) {
        setIpcError(err instanceof Error ? err.message : "Failed to set timer");
      }
    },
    [item.id, onDismiss],
  );

  const handleNever = useCallback(async () => {
    try {
      await window.tempdlm.setTimer({ itemId: item.id, minutes: null });
      onDismiss();
    } catch (err) {
      setIpcError(err instanceof Error ? err.message : "Failed to set timer");
    }
  }, [item.id, onDismiss]);

  const MAX_MINUTES = 40_320; // 28 days

  const handleCustomSubmit = useCallback(async () => {
    const num = parseFloat(customValue);
    if (!customValue || isNaN(num) || num <= 0) {
      setCustomError("Enter a positive number");
      return;
    }

    let minutes: number;
    switch (customUnit) {
      case "minutes":
        minutes = num;
        break;
      case "hours":
        minutes = num * 60;
        break;
      case "days":
        minutes = num * 1440;
        break;
    }

    if (minutes > MAX_MINUTES) {
      setCustomError("Maximum is 28 days (40,320 minutes)");
      return;
    }

    try {
      await window.tempdlm.setTimer({ itemId: item.id, minutes });
      onDismiss();
    } catch (err) {
      setIpcError(err instanceof Error ? err.message : "Failed to set timer");
    }
  }, [customUnit, customValue, item.id, onDismiss]);

  function handleCustomValueChange(val: string) {
    setCustomValue(val);
    if (customError) setCustomError("");
  }

  const focusCustomAmountInput = useCallback(() => {
    setShowCustom(true);
    window.setTimeout(() => customAmountInputRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();

      if (key === "escape") {
        event.preventDefault();
        onDismiss();
        return;
      }

      if (key === "enter" && showCustom) {
        event.preventDefault();
        void handleCustomSubmit();
        return;
      }

      if (isEditableTarget(event.target)) return;

      switch (key) {
        case "1":
          event.preventDefault();
          void handlePreset(5);
          break;
        case "2":
          event.preventDefault();
          void handlePreset(30);
          break;
        case "3":
          event.preventDefault();
          void handlePreset(120);
          break;
        case "4":
          event.preventDefault();
          void handlePreset(1440);
          break;
        case "n":
          event.preventDefault();
          void handleNever();
          break;
        case "c":
          event.preventDefault();
          focusCustomAmountInput();
          break;
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [
    showCustom,
    onDismiss,
    handleCustomSubmit,
    handleNever,
    handlePreset,
    focusCustomAmountInput,
  ]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed bottom-4 right-4 w-80 bg-white border border-neutral-200 dark:bg-neutral-900 dark:border-neutral-700 rounded-xl shadow-2xl p-4 z-50"
      role="dialog"
      aria-label="New file detected"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-0.5">New file detected</p>
          <p
            className="text-sm font-medium text-neutral-900 dark:text-neutral-100 overflow-hidden whitespace-nowrap"
            title={item.fileName}
          >
            {middleTruncate(item.fileName)}
          </p>
          <p className="text-xs text-neutral-500 mt-0.5">
            {formatBytes(item.fileSize)}
            {item.fileExtension && (
              <span className="ml-2 uppercase text-neutral-400 dark:text-neutral-600">
                {item.fileExtension.replace(".", "")}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="ml-2 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300 text-lg leading-none flex-shrink-0"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>

      {/* IPC error */}
      {ipcError && (
        <p className="text-xs text-red-500 dark:text-red-400 mb-2" role="alert">
          {ipcError}
        </p>
      )}

      {/* Prompt */}
      <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">Delete after…</p>

      {/* Preset buttons */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        {PRESETS.map(({ label, minutes }) => (
          <button
            key={label}
            onClick={() => handlePreset(minutes)}
            className="py-1.5 px-3 text-sm rounded-lg bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 transition-colors"
          >
            {label}
          </button>
        ))}
      </div>

      {/* Custom + Never row */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <button
          onClick={() => setShowCustom((v) => !v)}
          className="py-1.5 px-3 text-sm rounded-lg bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 transition-colors"
        >
          Custom…
        </button>
        <button
          onClick={handleNever}
          className="py-1.5 px-3 text-sm rounded-lg bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400 transition-colors"
        >
          Never
        </button>
      </div>

      {/* Custom input panel */}
      {showCustom && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <input
              ref={customAmountInputRef}
              type="number"
              min="1"
              max="40320"
              value={customValue}
              onChange={(e) => handleCustomValueChange(e.target.value)}
              placeholder="Amount"
              aria-label="Custom duration amount"
              className="flex-1 min-w-0 bg-white border border-neutral-300 dark:bg-neutral-800 dark:border-neutral-600 rounded-lg px-3 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500"
            />
            <select
              value={customUnit}
              onChange={(e) => setCustomUnit(e.target.value as typeof customUnit)}
              aria-label="Custom duration unit"
              className="bg-white border border-neutral-300 dark:bg-neutral-800 dark:border-neutral-600 rounded-lg px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-blue-500"
            >
              <option value="minutes">min</option>
              <option value="hours">hrs</option>
              <option value="days">days</option>
            </select>
          </div>
          {customError && (
            <p className="text-xs text-red-500 dark:text-red-400" role="alert">
              {customError}
            </p>
          )}
          <button
            onClick={handleCustomSubmit}
            className="w-full py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            Set timer
          </button>
        </div>
      )}
    </div>
  );
}
