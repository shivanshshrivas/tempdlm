# TempDLM - Temporary Download Manager

A lightweight desktop application that prevents Downloads folder clutter by letting you set auto-deletion timers when files are downloaded.

## The Problem

Your Downloads folder is a graveyard of forgotten files. PDFs you printed once, installers you ran, images you shared - they pile up endlessly. You either waste time cleaning up manually or let clutter grow until disk space runs out.

## The Solution

TempDLM watches your Downloads folder. When a new file appears, it asks one simple question: **"How long do you need this?"**

Choose from 5 minutes, 30 minutes, 2 hours, 1 day, or "Never" - and forget about it. When time's up, the file moves to your Recycle Bin (recoverable if needed).

## Features

- **Smart Detection** - Monitors your Downloads folder for new files
- **Quick Timer Dialog** - Set deletion time with one click or keyboard shortcut
- **Safe Deletion** - Files go to Recycle Bin, not permanent deletion
- **File-in-Use Protection** - Alerts you before deleting open files with snooze options
- **Queue Management** - View, search, sort, and edit all scheduled deletions
- **Whitelist Rules** - Auto-handle certain file types (never delete .exe, always delete temp files after 5 min)
- **System Tray** - Runs quietly in the background

## Screenshots

_Coming soon_

## Installation

### Windows

Download the latest installer from [Releases](https://github.com/your-username/tempdlm/releases).

### macOS / Linux

_Coming in future releases_

## Development

### Prerequisites

- Node.js 18+
- npm 9+

### Setup

```bash
git clone https://github.com/your-username/tempdlm.git
cd tempdlm
npm install
npm run dev
```

### Build

```bash
# Development build
npm run build

# Production installer (Windows)
npm run dist:win
```

### Project Structure

```plain
tempdlm/
├── src/
│   ├── main/           # Electron main process
│   │   ├── index.ts    # App entry point
│   │   ├── fileWatcher.ts
│   │   ├── timerManager.ts
│   │   ├── deletionEngine.ts
│   │   ├── trayManager.ts
│   │   └── store.ts
│   ├── renderer/       # React UI
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   └── stores/
│   └── preload/        # IPC bridge
│       └── index.ts
├── docs/
│   ├── idea.md         # Project vision and scope
│   ├── specifications.md    # Technical specifications
│   └── technical-challenges.md
├── build/              # Build resources (icons, installer scripts)
├── dist/               # Build output
└── package.json
```

## Documentation

- [Project Vision and Scope](docs/idea.md)
- [Technical Specifications](docs/specifications.md)
- [Technical Challenges and Solutions](docs/technical-challenges.md)

## Tech Stack

- **Framework:** Electron 28+
- **UI:** React 18 + TypeScript
- **Build:** Vite + Electron Forge
- **Styling:** Tailwind CSS
- **State:** Zustand
- **File Watching:** chokidar
- **Trash API:** trash (cross-platform)

## Roadmap

### Phase 1 (MVP) - Windows

- [x] Project specification
- [ ] Core file watching
- [ ] Timer dialog and management
- [ ] Queue UI with search/sort
- [ ] System tray integration
- [ ] Windows installer

### Phase 2 - Enhanced Features

- [ ] macOS support
- [ ] Download clustering
- [ ] Statistics dashboard
- [ ] Keyboard shortcuts

### Phase 3 - Extended Platform

- [ ] Linux support
- [ ] Browser extension (optional)
- [ ] Multi-folder monitoring

## Contributing

Contributions are welcome! Please read the [contributing guidelines](CONTRIBUTING.md) first.

## License

MIT License - see [LICENSE](LICENSE) for details.

---

**Note:** This project is in active development. The specification documents in `/docs` contain the complete technical design.

---

## Naming Convention

- **TempDLM** (proper case) - User-facing product name (window titles, installer, branding)
- **tempdlm** (lowercase) - Technical identifier (repo name, package name, commands, file paths)
