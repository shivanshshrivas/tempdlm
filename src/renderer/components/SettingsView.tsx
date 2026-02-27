import { useState, useEffect } from "react";
import { type UserSettings, type TimerPreset, type WhitelistRule } from "../../shared/types";

// ─── Timer preset selector ─────────────────────────────────────────────────────

const TIMER_PRESETS: { label: string; value: TimerPreset }[] = [
  { label: "5m", value: "5m" },
  { label: "30m", value: "30m" },
  { label: "2h", value: "2h" },
  { label: "1d", value: "1d" },
  { label: "Never", value: "never" },
];

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-4">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={htmlFor} className="text-sm text-neutral-300 flex-1">
        {label}
      </label>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ─── Whitelist rule row ────────────────────────────────────────────────────────

function WhitelistRuleRow({
  rule,
  onRemove,
}: {
  rule: WhitelistRule;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-neutral-800 rounded-lg">
      <span className="flex-1 text-sm text-neutral-300 font-mono">{rule.value}</span>
      <span className="text-xs text-neutral-500 capitalize">
        {rule.action === "never-delete" ? "Never delete" : "Auto-delete"}
      </span>
      <button
        onClick={() => onRemove(rule.id)}
        aria-label={`Remove whitelist rule ${rule.value}`}
        className="text-xs text-red-400 hover:text-red-300 transition-colors"
      >
        Remove
      </button>
    </div>
  );
}

// ─── Add whitelist rule form ───────────────────────────────────────────────────

const EXTENSION_RE = /^\.[a-z0-9]{1,10}$/i;
const PATH_SEP_RE = /[/\\]/;

function AddRuleForm({ onAdd }: { onAdd: (rule: Omit<WhitelistRule, "id">) => void }) {
  const [value, setValue] = useState("");
  const [action, setAction] = useState<WhitelistRule["action"]>("never-delete");
  const [ruleError, setRuleError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    // Validate extension rules: must be .ext format (1–10 alphanumeric chars)
    if (!EXTENSION_RE.test(trimmed)) {
      setRuleError('Must be a file extension like ".pdf" (letters/digits, max 10 chars)');
      return;
    }

    // Guard against path separators slipping through
    if (PATH_SEP_RE.test(trimmed)) {
      setRuleError("Rule value must not contain path separators");
      return;
    }

    setRuleError("");
    onAdd({
      type: "extension",
      value: trimmed.toLowerCase(),
      action,
      enabled: true,
    });
    setValue("");
  }

  function handleValueChange(val: string) {
    setValue(val);
    if (ruleError) setRuleError("");
  }

  return (
    <div className="mt-2 space-y-1">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => handleValueChange(e.target.value)}
          placeholder=".pdf, .exe, …"
          aria-label="New whitelist rule value"
          className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
        />
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as WhitelistRule["action"])}
          aria-label="Whitelist rule action"
          className="bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1.5 text-xs text-neutral-300 focus:outline-none focus:border-blue-500"
        >
          <option value="never-delete">Never delete</option>
          <option value="auto-delete-after">Auto-delete</option>
        </select>
        <button
          type="submit"
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg transition-colors"
        >
          Add
        </button>
      </form>
      {ruleError && (
        <p className="text-xs text-red-400" role="alert">
          {ruleError}
        </p>
      )}
    </div>
  );
}

// ─── Update error helper ─────────────────────────────────────────────────────

function friendlyUpdateError(raw: string): string {
  if (/ENOTFOUND|ENETUNREACH|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/i.test(raw))
    return "No internet connection.";
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|timeout/i.test(raw)) return "Connection timed out.";
  if (/HttpError:\s*404|Cannot find.*latest\.yml/i.test(raw)) return "No releases published yet.";
  if (/HttpError:\s*5\d\d/i.test(raw)) return "GitHub is temporarily unavailable.";
  return "Update check failed.";
}

// ─── Main component ───────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: UserSettings = {
  downloadsFolder: "",
  launchAtStartup: false,
  defaultTimer: "never",
  customDefaultMinutes: 60,
  theme: "system",
  showNotifications: true,
  dialogPosition: "bottom-right",
  whitelistRules: [],
};

/**
 * Settings panel for configuring downloads folder, timers, notifications,
 * theme, and whitelist rules. Tracks unsaved changes before persisting.
 * @returns The settings view element.
 */
export default function SettingsView() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "up-to-date" | "error">(
    "idle",
  );
  const [updateError, setUpdateError] = useState("");

  useEffect(() => {
    window.tempdlm.getSettings().then(setSettings);
    window.tempdlm.getAppVersion().then(setAppVersion);

    // Listen for update errors so the button can show inline feedback
    const unsub = window.tempdlm.onUpdateError((message) => {
      // No releases published (404) — show "Up to date" instead of an error
      if (/HttpError:\s*404|Cannot find.*latest\.yml/i.test(message)) {
        setUpdateStatus("up-to-date");
        return;
      }
      setUpdateStatus("error");
      setUpdateError(friendlyUpdateError(message));
    });
    return () => {
      unsub();
    };
  }, []);

  function patch(partial: Partial<UserSettings>) {
    setSettings((prev) => ({ ...prev, ...partial }));
    setDirty(true);
    setSaved(false);
    setSaveError("");
  }

  async function handlePickFolder() {
    const folder = await window.tempdlm.pickFolder();
    if (folder) patch({ downloadsFolder: folder });
  }

  async function handleSave() {
    setSaveError("");
    const result = await window.tempdlm.updateSettings(settings);
    if (result.success) {
      setDirty(false);
      setSaved(true);
    } else {
      setSaveError(result.error ?? "Failed to save settings");
    }
  }

  function handleAddRule(rule: Omit<WhitelistRule, "id">) {
    const newRule: WhitelistRule = { ...rule, id: crypto.randomUUID() };
    patch({ whitelistRules: [...settings.whitelistRules, newRule] });
  }

  function handleRemoveRule(id: string) {
    patch({
      whitelistRules: settings.whitelistRules.filter((r) => r.id !== id),
    });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col px-6 py-6 max-w-2xl mx-auto w-full">
        <h1 className="text-lg font-semibold text-neutral-100 mb-6">Settings</h1>

        {/* General */}
        <Section title="General">
          <Row label="Downloads folder" htmlFor="downloads-folder">
            <div className="flex items-center gap-2">
              <span
                id="downloads-folder"
                className="text-xs text-neutral-400 max-w-48 truncate"
                title={settings.downloadsFolder}
              >
                {settings.downloadsFolder || "Not set"}
              </span>
              <button
                onClick={handlePickFolder}
                aria-label="Browse for downloads folder"
                className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 text-neutral-300 text-xs rounded transition-colors"
              >
                Browse…
              </button>
            </div>
          </Row>

          <Row label="Launch at startup">
            <input
              id="launch-at-startup"
              type="checkbox"
              checked={settings.launchAtStartup}
              onChange={(e) => patch({ launchAtStartup: e.target.checked })}
              aria-label="Launch at startup"
              className="w-4 h-4 accent-blue-500"
            />
          </Row>

          <Row label="Show notifications">
            <input
              id="show-notifications"
              type="checkbox"
              checked={settings.showNotifications}
              onChange={(e) => patch({ showNotifications: e.target.checked })}
              aria-label="Show notifications"
              className="w-4 h-4 accent-blue-500"
            />
          </Row>
        </Section>

        {/* Timer */}
        <Section title="Default timer">
          <div className="flex gap-2">
            {TIMER_PRESETS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => patch({ defaultTimer: value })}
                aria-pressed={settings.defaultTimer === value}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                  settings.defaultTimer === value
                    ? "bg-blue-600 text-white"
                    : "bg-neutral-800 text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </Section>

        {/* Whitelist */}
        <Section title="Whitelist rules">
          <p className="text-xs text-neutral-500">
            Files matching these rules will be handled automatically.
          </p>
          <div className="space-y-2">
            {settings.whitelistRules.length === 0 ? (
              <p className="text-xs text-neutral-600">No rules added.</p>
            ) : (
              settings.whitelistRules.map((rule) => (
                <WhitelistRuleRow key={rule.id} rule={rule} onRemove={handleRemoveRule} />
              ))
            )}
          </div>
          <AddRuleForm onAdd={handleAddRule} />
        </Section>

        {/* Save */}
        <div className="flex items-center gap-3 mt-2 mb-8">
          <button
            onClick={handleSave}
            disabled={!dirty}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${
              dirty
                ? "bg-blue-600 hover:bg-blue-500 text-white"
                : "bg-neutral-700 text-neutral-400 cursor-default"
            }`}
          >
            {dirty ? "Save changes" : "Saved"}
          </button>
          {dirty && !saveError && <span className="text-xs text-amber-400">Unsaved changes</span>}
          {saved && !dirty && <span className="text-xs text-green-400">Settings saved.</span>}
          {saveError && (
            <span className="text-xs text-red-400" role="alert">
              {saveError}
            </span>
          )}
        </div>

        {/* About */}
        <Section title="About">
          <Row label="Version">
            <span className="text-xs text-neutral-400 font-mono">
              {appVersion ? `v${appVersion}` : "—"}
            </span>
          </Row>
          <Row label="Updates">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setUpdateStatus("checking");
                  setUpdateError("");
                  window.tempdlm.checkForUpdate().then(() => {
                    // If no update-available or error event fires within 5s, show "up to date"
                    setTimeout(
                      () => setUpdateStatus((s) => (s === "checking" ? "up-to-date" : s)),
                      5000,
                    );
                  });
                }}
                disabled={updateStatus === "checking"}
                className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 text-neutral-300 text-xs rounded transition-colors disabled:opacity-50"
              >
                {updateStatus === "checking"
                  ? "Checking…"
                  : updateStatus === "up-to-date"
                    ? "Up to date"
                    : updateStatus === "error"
                      ? "Retry"
                      : "Check for Updates"}
              </button>
              {updateStatus === "error" && (
                <span className="text-[10px] text-red-400">{updateError}</span>
              )}
            </div>
          </Row>
        </Section>
      </div>
    </div>
  );
}
