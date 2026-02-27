import { useEffect, useState } from "react";
import { type QueueItem, type ConfirmDeletePayload } from "../shared/types";
import { useQueueStore } from "./store/useQueueStore";
import QueueView from "./components/QueueView";
import SettingsView from "./components/SettingsView";
import NewFileDialog from "./components/NewFileDialog";
import ConfirmDeleteDialog from "./components/ConfirmDeleteDialog";
import UpdateNotification from "./components/UpdateNotification";
import { playNewFileChime, playConfirmChime } from "./utils/sound";
import { applyTheme } from "./utils/theme";

// ─── Nav types ────────────────────────────────────────────────────────────────

type View = "queue" | "settings";

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ view, onNavigate }: { view: View; onNavigate: (v: View) => void }) {
  return (
    <nav
      className="flex flex-col w-14 shrink-0 bg-neutral-100 border-r border-neutral-200 dark:bg-neutral-900 dark:border-neutral-800 items-center py-4 gap-2"
      aria-label="Main navigation"
    >
      <button
        onClick={() => onNavigate("queue")}
        aria-label="Queue"
        aria-current={view === "queue" ? "page" : undefined}
        title="Queue"
        className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
          view === "queue"
            ? "bg-blue-600 text-white"
            : "text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200 dark:hover:text-neutral-200 dark:hover:bg-neutral-800"
        }`}
      >
        {/* List icon */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </button>

      <button
        onClick={() => onNavigate("settings")}
        aria-label="Settings"
        aria-current={view === "settings" ? "page" : undefined}
        title="Settings"
        className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
          view === "settings"
            ? "bg-blue-600 text-white"
            : "text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200 dark:hover:text-neutral-200 dark:hover:bg-neutral-800"
        }`}
      >
        {/* Gear icon */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </nav>
  );
}

// ─── Dialog queue manager ──────────────────────────────────────────────────────
// Keeps a queue of pending items waiting for user timer selection.
// Shows one dialog at a time; dismissed items stay in the queue store as-is.

function DialogQueue() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const { updateItem } = useQueueStore();

  useEffect(() => {
    const unsub = window.tempdlm.onFileNew((item) => {
      setQueue((q) => [...q, item]);
      playNewFileChime();
    });
    return () => {
      unsub();
    };
  }, []);

  if (queue.length === 0) return null;

  const current = queue[0];

  function dismiss() {
    setQueue((q) => q.slice(1));
  }

  // When the user picks a timer, setTimer is called inside NewFileDialog.
  // We listen for store updates that change the item's status to remove it
  // from the local queue as well.
  function handleDismiss() {
    updateItem(current.id, { status: "pending" });
    dismiss();
  }

  return (
    <div className="fixed bottom-4 right-4 z-50" aria-live="polite">
      <NewFileDialog item={current} onDismiss={handleDismiss} />
      {queue.length > 1 && (
        <p className="text-xs text-neutral-500 text-right mt-1">
          +{queue.length - 1} more file{queue.length - 1 > 1 ? "s" : ""} waiting
        </p>
      )}
    </div>
  );
}

// ─── Confirm-deletion queue manager ───────────────────────────────────────────
// Shows one confirmation dialog at a time when a file may be open in another program.

function ConfirmQueue() {
  const [queue, setQueue] = useState<ConfirmDeletePayload[]>([]);

  useEffect(() => {
    const unsub = window.tempdlm.onFileConfirmDelete((payload) => {
      setQueue((q) => [...q, payload]);
      playConfirmChime();
    });
    return () => {
      unsub();
    };
  }, []);

  if (queue.length === 0) return null;

  const current = queue[0];

  function dismiss() {
    setQueue((q) => q.slice(1));
  }

  return (
    <div className="fixed bottom-24 right-4 z-50" aria-live="assertive">
      <ConfirmDeleteDialog payload={current} onDismiss={dismiss} />
      {queue.length > 1 && (
        <p className="text-xs text-neutral-500 text-right mt-1">
          +{queue.length - 1} more confirmation
          {queue.length - 1 > 1 ? "s" : ""} waiting
        </p>
      )}
    </div>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────

/**
 * Root application component — renders the active view (queue or settings)
 * and subscribes to main-process IPC events for queue and dialog updates.
 * @returns The main application layout element.
 */
export default function App() {
  const [view, setView] = useState<View>("queue");
  const { setItems, updateItem, setLoading } = useQueueStore();

  // Bootstrap: load queue + subscribe to main-process events
  useEffect(() => {
    setLoading(true);
    window.tempdlm.getQueue().then((queue) => {
      setItems(queue);
      setLoading(false);
    });

    const unsubs = [
      window.tempdlm.onFileDeleted((id) =>
        updateItem(id, { status: "deleted", scheduledFor: null }),
      ),
      window.tempdlm.onQueueUpdated(setItems),
    ];

    return () => unsubs.forEach((fn) => fn());
  }, [setItems, setLoading, updateItem]);

  // Re-apply theme when the OS dark/light preference changes (for "system" mode).
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange() {
      window.tempdlm.getSettings().then((s) => {
        if (s.theme === "system") applyTheme("system");
      });
    }
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  return (
    <div className="flex h-screen bg-white text-neutral-900 font-sans dark:bg-neutral-950 dark:text-neutral-100">
      <Sidebar view={view} onNavigate={setView} />

      <main className="flex-1 min-w-0 overflow-hidden">
        {view === "queue" && <QueueView />}
        {view === "settings" && <SettingsView />}
      </main>

      <DialogQueue />
      <ConfirmQueue />
      <UpdateNotification />
    </div>
  );
}
