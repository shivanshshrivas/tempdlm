# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | ✅ Active |
| < 1.0   | ❌ No     |

## Reporting a Vulnerability


**Please do not report security vulnerabilities through public GitHub issues.**

### Option 1 — GitHub Private Vulnerability Reporting (preferred)

Use GitHub's built-in private reporting:
**[Report a vulnerability](https://github.com/shivanshshrivas/tempdlm/security/advisories/new)**

This keeps the details confidential until a fix is released.

### Option 2 — Email

If you cannot use GitHub's reporting tool, email the maintainer directly.
Contact information is available on the [GitHub profile](https://github.com/shivanshshrivas).

## What to Include

A useful report includes:

- A description of the vulnerability and its potential impact
- Steps to reproduce (proof-of-concept code or screenshots if applicable)
- The version of TempDLM where you observed the issue
- Your suggested fix or mitigation, if any

## Response Timeline

| Stage                          | Target                                                     |
| ------------------------------ | ---------------------------------------------------------- |
| Initial acknowledgement        | Within 3 business days                                     |
| Triage and severity assessment | Within 7 business days                                     |
| Fix or mitigation released     | Depends on severity (critical: ASAP, high: within 30 days) |

## Scope

TempDLM is a local desktop application. The relevant attack surface includes:

- **IPC boundary** between the renderer process and main process
- **File system operations** — the app reads/watches the Downloads folder and moves files to the Recycle Bin
- **PowerShell invocation** — used for Windows Restart Manager file-lock detection
- **Auto-update mechanism** — downloads and installs updates from GitHub Releases
- **`shell.openExternal`** — opens URLs in the default browser (allowlisted to `github.com/shivanshshrivas/tempdlm/`)

Out of scope: vulnerabilities that require physical access to the machine or that exploit the underlying OS rather than TempDLM itself.

## Technical Security Documentation

For a full description of the security architecture, hardening decisions, IPC validation,
file-system safety, and known accepted risks, see [`docs/security.md`](../docs/security.md).
