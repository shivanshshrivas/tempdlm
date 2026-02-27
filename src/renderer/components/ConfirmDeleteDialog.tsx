import { useState, useEffect, useRef, useCallback } from "react";
import { type ConfirmDeletePayload } from "../../shared/types";
import { middleTruncate } from "../utils/format";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  payload: ConfirmDeletePayload;
  onDismiss: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Dialog shown when the window-title heuristic detects that a file may still
 * be open. Presents a countdown and lets the user confirm deletion or keep the
 * file. Automatically resolves to 'delete' when the countdown expires.
 * @param props - Component props (see Props interface).
 * @returns The confirmation dialog element.
 */
export default function ConfirmDeleteDialog({ payload, onDismiss }: Props) {
  const { item, processNames, timeoutMs, confirmationStartedAt } = payload;
  const deadline = confirmationStartedAt + timeoutMs;
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, deadline - Date.now()));
  const responded = useRef(false);

  const handleDelete = useCallback(() => {
    if (responded.current) return;
    responded.current = true;
    window.tempdlm.confirmDeleteResponse({
      itemId: item.id,
      decision: "delete",
    });
    onDismiss();
  }, [item.id, onDismiss]);

  const handleKeep = useCallback(() => {
    if (responded.current) return;
    responded.current = true;
    window.tempdlm.confirmDeleteResponse({ itemId: item.id, decision: "keep" });
    onDismiss();
  }, [item.id, onDismiss]);

  useEffect(() => {
    const interval = setInterval(() => {
      const left = deadline - Date.now();
      if (left <= 0) {
        clearInterval(interval);
        setRemainingMs(0);
        if (!responded.current) {
          responded.current = true;
          window.tempdlm.confirmDeleteResponse({
            itemId: item.id,
            decision: "delete",
          });
          onDismiss();
        }
      } else {
        setRemainingMs(left);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [item.id, deadline, onDismiss]);

  const progressFraction = remainingMs / timeoutMs;
  const processLabel = processNames.join(", ");

  return (
    <div
      className="w-80 bg-white border border-amber-400/50 dark:bg-neutral-900 dark:border-amber-700/50 rounded-xl shadow-2xl p-4"
      role="alertdialog"
      aria-label="Confirm file deletion"
    >
      <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mb-1">
        File may be open
      </p>
      <p
        className="text-sm text-neutral-900 dark:text-neutral-100 overflow-hidden whitespace-nowrap mb-1"
        title={item.fileName}
      >
        {middleTruncate(item.fileName)}
      </p>
      <p className="text-xs text-neutral-600 dark:text-neutral-400 mb-3">
        <span className="font-medium text-neutral-800 dark:text-neutral-300">{processLabel}</span>{" "}
        may have this file open.
      </p>

      <div className="h-1 bg-neutral-200 dark:bg-neutral-700 rounded-full mb-3 overflow-hidden">
        <div
          className="h-full bg-amber-500 transition-all duration-100 ease-linear rounded-full"
          style={{ width: `${progressFraction * 100}%` }}
        />
      </div>
      <p className="text-xs text-neutral-500 text-right mb-3">
        Auto-deleting in {Math.ceil(remainingMs / 1000)}s
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={handleKeep}
          className="py-1.5 px-3 text-sm rounded-lg bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 transition-colors"
        >
          Keep file
        </button>
        <button
          onClick={handleDelete}
          className="py-1.5 px-3 text-sm rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors"
        >
          Delete anyway
        </button>
      </div>
    </div>
  );
}
