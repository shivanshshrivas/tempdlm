# TempDLM - Temporary Download Manager

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![License](https://img.shields.io/badge/license-CC%20BY--NC--ND%204.0-green)
![Release](https://img.shields.io/github/downloads/shivanshshrivas/tempdlm/total)

A lightweight Windows desktop app that prevents Downloads folder clutter by letting you set auto-deletion timers the moment a file arrives.

## The Problem

Your Downloads folder is a graveyard. PDFs you printed once, installers you ran, images you shared - they pile up endlessly. You either spend time cleaning manually or let the clutter grow until disk space runs out.

## The Solution

TempDLM watches your Downloads folder. When a new file appears, it asks one simple question: **"How long do you need this?"**

Pick 5 minutes, 30 minutes, 2 hours, 1 day, or Never - then forget about it. When time's up, the file moves to your Recycle Bin (recoverable if needed). If a file is open in another app, TempDLM detects it and asks before acting.

## Features

- **Instant detection** - New files trigger a dialog within 500ms
- **Smart lock detection** - Won't delete files that are open in another app
- **Safe deletion** - Files go to Recycle Bin, never permanently deleted
- **Queue management** - View, search, sort, cancel, or edit every scheduled deletion
- **Whitelist rules** - Auto-handle file types (e.g. never delete `.exe` files)
- **System tray** - Runs quietly in the background
- **Persistent queue** - Timers survive app restarts

## Installation

Download the latest installer from [Releases](https://github.com/shivanshshrivas/tempdlm/releases).

> [!NOTE]
> Requires Windows 10 or 11.

## License

[CC BY-NC-ND 4.0](LICENSE) — Source-available. Free to use personally; no derivatives or commercial use.
