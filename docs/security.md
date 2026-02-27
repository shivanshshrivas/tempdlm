# TempDLM Security Documentation

This document describes the security architecture, hardening decisions, input validation strategy, and known trade-offs for TempDLM v1.x.

<details>
<summary><strong>Change log</strong> (last updated: 2026-02-26)</summary>

| Date       | Issue                                                       | Summary                                        |
| ---------- | ----------------------------------------------------------- | ---------------------------------------------- |
| 2026-02-26 | [#26](https://github.com/shivanshshrivas/tempdlm/issues/26) | minimatch high vuln fixed (→ 10.2.4)           |
| 2026-02-25 | [#15](https://github.com/shivanshshrivas/tempdlm/issues/15) | GitHub Actions CI with `npm audit` enforcement |
| 2026-02-25 | —                                                           | Rollup path-traversal vuln fixed (→ 4.59.0)    |
| 2026-02-25 | [#9](https://github.com/shivanshshrivas/tempdlm/issues/9)   | Auto-update support                            |
| 2026-02-25 | [#8](https://github.com/shivanshshrivas/tempdlm/issues/8)   | Security audit                                 |

</details>

## 1. Security Architecture Overview

TempDLM uses Electron's multi-process model, which provides a natural security boundary:

```plain
┌─────────────────────────────────────────────┐
│  Main Process (Node.js)                     │
│  • File system operations                   │
│  • Timer scheduling                         │
│  • PowerShell invocation                    │
│  • electron-store persistence               │
│  • Auto-update via electron-updater         │
│  • All IPC input validation                 │
└───────────────────┬─────────────────────────┘
                    │ contextBridge (IPC)
┌───────────────────▼─────────────────────────┐
│  Preload Script (sandboxed bridge)          │
│  • Exposes typed, minimal API surface       │
│  • No direct Node.js access                 │
└───────────────────┬─────────────────────────┘
                    │ window.tempdlm
┌───────────────────▼─────────────────────────┐
│  Renderer Process (Chromium, isolated)      │
│  • React UI                                 │
│  • No Node.js, no require(), no fs access   │
└─────────────────────────────────────────────┘
```

The renderer is treated as an **untrusted boundary**: all data it sends via IPC is validated in the main process before acting on it. The renderer never directly touches the file system.

## 2. Electron Hardening

| Setting            | Value   | Reason                                                                |
| ------------------ | ------- | --------------------------------------------------------------------- |
| `contextIsolation` | `true`  | Renderer JavaScript cannot access the preload or Node.js global scope |
| `nodeIntegration`  | `false` | Renderer has no `require()` - cannot import Node.js modules           |
| `sandbox`          | `false` | Required (see below)                                                  |

### `sandbox: false` - Rationale and Mitigations

`sandbox: false` is set on the renderer's `BrowserWindow`. This is required because the preload script uses ESM dynamic imports (`electron-store`, `trash`) that depend on Node.js module resolution. Enabling the sandbox would break these imports at startup.

**Compensating controls that mitigate the risk:**

1. `contextIsolation: true` - the renderer cannot reach the preload's Node.js scope.
2. `nodeIntegration: false` - the renderer has no `require()` entry point.
3. All IPC payloads from the renderer are validated before use in the main process (see §6).
4. The application does not load remote content; all pages are local HTML/JS.
5. No `eval()` or dynamic script loading in renderer code.

## 3. IPC API Surface

### Main → Renderer events (read-only push)

| Channel                    | Payload                | Notes                                            |
| -------------------------- | ---------------------- | ------------------------------------------------ |
| `file:new`                 | `QueueItem`            | New file detected - triggers dialog              |
| `file:deleted`             | `itemId: string`       | Deletion confirmed                               |
| `file:in-use`              | `QueueItem`            | File locked - snoozed                            |
| `file:confirm-delete`      | `ConfirmDeletePayload` | Layer-2 heuristic match - awaiting user decision |
| `queue:updated`            | `QueueItem[]`          | Full queue refresh                               |
| `update:available`         | `AppUpdateInfo`        | New version found on GitHub Releases             |
| `update:download-progress` | `UpdateProgress`       | Download percentage and speed                    |
| `update:downloaded`        | (none)                 | Update package ready to install                  |
| `update:error`             | `string`               | Error message from updater                       |

### Renderer → Main invocations

| Channel                 | Input validated                            | Guard                     |
| ----------------------- | ------------------------------------------ | ------------------------- |
| `file:set-timer`        | `itemId` looked up in store before use     | Per-item pending-op guard |
| `file:cancel`           | `itemId` only used to cancel existing job  | -                         |
| `file:snooze`           | `itemId` looked up in store before use     | Per-item pending-op guard |
| `file:remove`           | `itemId` only used to remove from store    | -                         |
| `file:confirm-response` | `decision` is `"delete" \| "keep"` (typed) | -                         |
| `settings:get`          | None (read-only)                           | -                         |
| `settings:update`       | Full schema validation (see §6)            | Single pending-op guard   |
| `queue:get`             | None (read-only)                           | -                         |
| `dialog:pick-folder`    | None - result from OS dialog               | -                         |
| `app:get-version`       | None (read-only)                           | -                         |
| `update:check`          | None - triggers `autoUpdater` check        | -                         |
| `update:download`       | None - triggers `autoUpdater` download     | -                         |
| `update:install`        | None - calls `quitAndInstall()`            | -                         |
| `shell:open-external`   | URL allowlisted to repo origin (see §7)    | -                         |

All handlers return `{ success: boolean; error?: string; data?: T }`. The renderer receives a structured response and can surface errors to the user.

## 4. File System Safety

### Recycle Bin Policy

TempDLM **never permanently deletes files**. All deletions go through the `trash` npm package, which moves files to the OS Recycle Bin (Windows Recycle Bin, macOS Trash, or XDG trash on Linux). This is intentional - it provides a safety net for accidental timer selections.

### Lock Detection (Two-Layer)

**Layer 1 - Windows Restart Manager API (`rstrtmgr.dll`):**

- Inline C# compiled at runtime via PowerShell/`Add-Type`
- Enumerates all processes holding an open handle to the file
- Authoritative for all handle types regardless of sharing flags (same mechanism used by Windows Update)

**Layer 2 - Window-title heuristic:**

- `Get-Process | Where-Object { $_.MainWindowTitle -like '*<filename>*' }`
- Catches editors (e.g. Notepad) that read files into memory and immediately release the file handle - these are invisible to Restart Manager
- Fail-open: if PowerShell fails or times out, deletion proceeds normally

### Path Validation

`downloadsFolder` in settings is validated before being accepted:

1. Must be a non-empty string.
2. Must be an absolute path (`path.isAbsolute()`).
3. Must exist and be reachable (`fs.realpathSync()` - rejects dangling symlinks).
4. Must be a directory (`fs.statSync().isDirectory()`).
5. Must not be a blocked system path: `C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)`, `C:\ProgramData`.
6. The resolved (symlink-free) canonical path is stored, preventing symlink-redirect attacks.

The file watcher (`chokidar`) watches only the validated `downloadsFolder` path with `depth: 0`, so it never recurses into subdirectories.

## 5. PowerShell Invocation

Both PowerShell invocations use `child_process.spawnSync` directly - **not** `child_process.exec` and **not** `shell: true`. This means the process arguments are passed as an array; there is no shell interpretation of special characters in the command string.

### Single-quote escaping

File paths and file names interpolated into PowerShell `-Command` strings are escaped by replacing `'` with `''`:

```ts
const psPath = filePath.replace(/'/g, "''");
```

PowerShell single-quoted strings (`'...'`) are fully literal - only embedded single-quotes need doubling. This is the correct escaping for values inside `'...'` delimiters.

### Fail-open design

Both PowerShell calls have timeouts (5 000 ms for Restart Manager, 3 000 ms for window-title heuristic). On failure, error, or timeout:

- **Layer 1** falls back to a rename-probe lock test using `fs.renameSync`.
- **Layer 2** returns an empty array, meaning deletion proceeds without confirmation.

This prevents a stuck or unavailable PowerShell from blocking the deletion queue indefinitely.

## 6. Input Validation

### Settings patch (`settings:update` IPC)

`validateSettingsPatch()` in `src/main/settingsValidator.ts` validates every field before writing to the store:

| Field                                | Validation                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| `downloadsFolder`                    | Absolute, exists, is directory, resolved via `realpathSync`, not a blocked system path |
| `customDefaultMinutes`               | Integer, 1-40 320                                                                      |
| `defaultTimer`                       | Enum: `"5m" \| "30m" \| "2h" \| "1d" \| "never" \| "custom"`                           |
| `dialogPosition`                     | Enum: `"center" \| "bottom-right" \| "near-tray"`                                      |
| `theme`                              | Enum: `"system" \| "light" \| "dark"`                                                  |
| `launchAtStartup`                    | Boolean                                                                                |
| `showNotifications`                  | Boolean                                                                                |
| `whitelistRules[].value` (extension) | `/^\.[a-z0-9]{1,10}$/i`                                                                |
| `whitelistRules[].value` (filename)  | 1-255 chars, no path separators                                                        |

### Custom timer (renderer)

The `NewFileDialog` component enforces a maximum of **40 320 minutes (28 days)** client-side before sending the IPC call. The `<input type="number" max="40320">` attribute provides a browser-level hint.

### Whitelist rule values (renderer)

The `AddRuleForm` component validates extension values against `/^\.[a-z0-9]{1,10}$/i` before adding them to local state. Values containing path separators are rejected. The main process re-validates all `whitelistRules` on every `settings:update` call.

### Process names in confirm dialog

`isFileInWindowTitle()` truncates each process name to **32 characters** and the confirmation payload caps display at **3 process names**, appending `"…and N more"` if there are additional matches. This prevents excessively long process names from overflowing the UI.

## 7. Auto-Update Security

### Update source and transport

TempDLM uses `electron-updater` with GitHub Releases as the update provider. Updates are fetched over HTTPS from `https://github.com/shivanshshrivas/tempdlm/releases`. The `publish` configuration in `package.json` pins the owner and repo:

```json
"publish": {
  "provider": "github",
  "owner": "shivanshshrivas",
  "repo": "tempdlm"
}
```

`electron-updater` verifies downloaded update artifacts against the `latest.yml` manifest, which includes SHA-512 checksums. On Windows with code-signed builds, NSIS installer signatures are also verified.

### User consent model

- **`autoDownload: false`** - updates are never downloaded without the user clicking "Download & Install". The app only _checks_ for updates automatically (10 seconds after startup and every 6 hours).
- **`autoInstallOnAppQuit: true`** - if an update has been downloaded and the user quits normally, the update is applied silently. This avoids prompting on shutdown but still requires the user to have actively initiated the download.

### Packaged-only guard

`initUpdater()` is only called when `app.isPackaged === true`. In development mode the updater is never initialized, preventing spurious errors and accidental update checks against the production release feed.

### `shell:open-external` allowlist

The `shell:open-external` IPC handler (used for "View full release notes") restricts the URL to the exact repository origin:

```ts
url.startsWith("https://github.com/shivanshshrivas/tempdlm/");
```

This prevents the renderer from opening arbitrary URLs via the OS default browser. Only URLs under the project's GitHub repository are accepted; all other URLs are silently ignored.

### Update IPC handlers accept no renderer input

The four update-related IPC channels (`update:check`, `update:download`, `update:install`, `app:get-version`) accept **no payload from the renderer**. They are parameterless triggers that delegate to `electron-updater`'s built-in methods. There is no injection surface.

### Release notes rendering

Release notes from GitHub are displayed as **plain text** in the renderer. The `summarizeNotes()` function strips all markdown formatting and HTML tags before inserting into a React text node (not `dangerouslySetInnerHTML`). This eliminates XSS risk from malicious release note content.

### Data preservation during updates

User data (`queue`, `settings`) is stored by `electron-store` in `%APPDATA%/tempdlm/config.json`, which is outside the application install directory. NSIS updates replace the application binaries in `Program Files` without touching AppData, so queue and settings survive upgrades automatically. No migration logic is required.

## 8. Known Limitations & Accepted Risks

| Risk                                     | Severity      | Mitigation                                                                                                                  |
| ---------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `sandbox: false`                         | Medium        | `contextIsolation`, `nodeIntegration: false`, validated IPC (see §2)                                                        |
| PowerShell invocation                    | Low-Medium    | `spawnSync` (no shell), single-quote escaping, fail-open timeouts                                                           |
| Window-title heuristic is name-based     | Low           | Fail-open - false positives result in a confirmation dialog, not a missed deletion                                          |
| electron-store stores data as plain JSON | Low           | Data is user's own queue/settings; no secret material; file is in the user's profile directory with OS-level access control |
| Unsigned builds skip signature checks    | Low           | `electron-updater` still verifies SHA-512 checksums from `latest.yml`; code signing planned for production releases         |
| No IPC authentication                    | Informational | The IPC channel is local; Chromium's process model prevents renderer spoofing                                               |
| Windows-only lock detection              | Informational | macOS/Linux will use the rename-probe fallback; full support planned for v2.x                                               |

## 9. Security Checklist - OWASP Desktop App Top 10

| OWASP DA Risk                             | Status    | Notes                                                                                                 |
| ----------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| DA1 - Injections                          | Mitigated | PowerShell uses `spawnSync` + single-quote escaping; `openExternal` URL-allowlisted                   |
| DA2 - Broken Auth                         | N/A       | Single-user desktop app; no authentication surface                                                    |
| DA3 - Sensitive Data Exposure             | Low risk  | No secrets stored; queue/settings are non-sensitive user data                                         |
| DA4 - Improper Cryptography               | N/A       | No custom encryption; update verification delegated to `electron-updater` (SHA-512 + sigs)            |
| DA5 - Inadequate Supply Chain             | Mitigated | Dependencies audited; `npm audit` in CI; updates verified via checksums from GitHub Releases          |
| DA6 - Unprotected Sensitive Functionality | Mitigated | `contextIsolation` + `nodeIntegration: false`; IPC validated; `openExternal` allowlisted              |
| DA7 - Client-side Controls Bypass         | Mitigated | All business rules enforced in main process; renderer treated as untrusted                            |
| DA8 - Code Execution                      | Mitigated | `sandbox: false` accepted risk; `contextIsolation` + no remote content; release notes plain-text only |
| DA9 - Unprotected Functionality (IPC)     | Mitigated | All handlers validate input; update handlers accept no renderer input; structured responses           |
| DA10 - Outdated Components                | Mitigated | Auto-update via `electron-updater` ensures users run the latest version; `npm audit` in CI            |
