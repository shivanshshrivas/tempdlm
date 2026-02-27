import { useState, useEffect, useCallback } from "react";
import { type AppUpdateInfo, type UpdateProgress } from "../../shared/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type UpdateState = "idle" | "available" | "downloading" | "downloaded" | "error";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

/** Errors that should not spawn the floating notification popup. */
const SILENT_ERROR_RE =
  /HttpError:\s*404|Cannot find.*latest\.yml|ENOTFOUND|ENETUNREACH|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ETIMEDOUT|ESOCKETTIMEDOUT/i;

/**
 * Strips markdown formatting and truncates the result to a plain-text summary.
 * @param raw - Raw markdown string from the GitHub release notes.
 * @param maxLength - Maximum character length of the returned summary.
 * @returns Plain-text summary, truncated with "…" if longer than maxLength.
 */
function summarizeNotes(raw: string, maxLength = 200): string {
  const plain = raw
    .replace(/#+\s?/g, "") // headings
    .replace(/\*\*|__/g, "") // bold
    .replace(/\*|_/g, "") // italic
    .replace(/`{1,3}[^`]*`{1,3}/g, "") // inline/block code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "") // images
    .replace(/<[^>]+>/g, "") // HTML tags
    .replace(/\n{2,}/g, "\n") // collapse blank lines
    .trim();

  if (plain.length <= maxLength) return plain;
  return plain.slice(0, maxLength).trimEnd() + "…";
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Floating notification panel that surfaces update availability, download
 * progress, readiness to install, and error states.
 * @returns The notification panel element, or null when idle or dismissed.
 */
export default function UpdateNotification() {
  const [state, setState] = useState<UpdateState>("idle");
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);

  // ── IPC subscriptions ──────────────────────────────────────────────────────

  useEffect(() => {
    const unsubs = [
      window.tempdlm.onUpdateAvailable((updateInfo) => {
        setInfo(updateInfo);
        setState("available");
        setDismissed(false);
      }),
      window.tempdlm.onUpdateProgress((p) => {
        setProgress(p);
        setState("downloading");
      }),
      window.tempdlm.onUpdateDownloaded(() => {
        setState("downloaded");
      }),
      window.tempdlm.onUpdateError((message) => {
        // Network/404 errors are not worth a popup — SettingsView handles inline feedback
        if (SILENT_ERROR_RE.test(message)) return;
        setError(message);
        setState("error");
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleDownload = useCallback(() => {
    setState("downloading");
    setProgress(null);
    window.tempdlm.downloadUpdate();
  }, []);

  const handleInstall = useCallback(() => {
    window.tempdlm.installUpdate();
  }, []);

  const handleViewNotes = useCallback(() => {
    if (info?.releaseNotesUrl) {
      window.tempdlm.openExternal(info.releaseNotesUrl);
    }
  }, [info]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  // ── Don't render ──────────────────────────────────────────────────────────

  if (state === "idle" || dismissed) return null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed top-4 right-4 w-80 bg-white border border-neutral-200 dark:bg-neutral-900 dark:border-neutral-700 rounded-xl shadow-2xl p-4 z-50"
      role="dialog"
      aria-label="Application update"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">Update Available</p>
            {info && (
              <span className="text-[10px] font-mono bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                v{info.version}
              </span>
            )}
          </div>
          {info && <p className="text-[10px] text-neutral-500">{formatDate(info.releaseDate)}</p>}
        </div>
        <button
          onClick={handleDismiss}
          className="ml-2 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300 text-lg leading-none flex-shrink-0"
          aria-label="Dismiss update notification"
        >
          ×
        </button>
      </div>

      {/* Release notes summary */}
      {state === "available" && info?.releaseNotes && (
        <div className="mb-3">
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">What's new:</p>
          <p className="text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">
            {summarizeNotes(info.releaseNotes)}
          </p>
          <button
            onClick={handleViewNotes}
            className="text-[10px] text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 mt-1 transition-colors"
          >
            View full release notes
          </button>
        </div>
      )}

      {/* Download progress */}
      {state === "downloading" && (
        <div className="mb-3">
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">Downloading update…</p>
          <div className="w-full bg-neutral-200 dark:bg-neutral-800 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${Math.round(progress?.percent ?? 0)}%` }}
            />
          </div>
          <p className="text-[10px] text-neutral-500 mt-1">{Math.round(progress?.percent ?? 0)}%</p>
        </div>
      )}

      {/* Downloaded */}
      {state === "downloaded" && (
        <p className="text-xs text-green-600 dark:text-green-400 mb-3">
          Update downloaded. Restart to apply.
        </p>
      )}

      {/* Error */}
      {state === "error" && (
        <p className="text-xs text-red-500 dark:text-red-400 mb-3" role="alert">
          Update failed: {error.length > 120 ? error.slice(0, 120).trimEnd() + "…" : error}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {state === "available" && (
          <button
            onClick={handleDownload}
            className="flex-1 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            Download & Install
          </button>
        )}

        {state === "downloaded" && (
          <>
            <button
              onClick={handleInstall}
              className="flex-1 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              Restart Now
            </button>
            <button
              onClick={handleDismiss}
              className="py-1.5 px-3 text-sm rounded-lg bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 transition-colors"
            >
              Later
            </button>
          </>
        )}

        {state === "error" && (
          <button
            onClick={() => {
              setState("idle");
              setError("");
              window.tempdlm.checkForUpdate();
            }}
            className="flex-1 py-1.5 text-sm rounded-lg bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 transition-colors"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
