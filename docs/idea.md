# TempDLM - Temporary Download Manager

## Vision Statement

TempDLM is a lightweight desktop application that eliminates Downloads folder clutter by providing intelligent, user-controlled auto-deletion of downloaded files. Instead of letting temporary downloads accumulate indefinitely, TempDLM empowers users to set deletion timers at the moment of download, ensuring their system stays organized without manual cleanup effort.

## Problem Statement

The Downloads folder is universally recognized as one of the most cluttered locations on any computer. Users download files for immediate, temporary use (PDFs to print, installers to run, images to share) but rarely return to delete them. Over time, this leads to:

- **Wasted disk space** from forgotten files
- **Difficulty finding important downloads** buried among temporary ones
- **Manual cleanup sessions** that consume time and mental energy
- **Privacy concerns** from sensitive documents lingering indefinitely
- **System slowdown** from excessive file accumulation

Current solutions are either too aggressive (auto-delete everything after X days) or require too much manual effort (periodic cleanup). There is no solution that asks the user at the right moment: "How long do you need this file?"

## Solution Overview

TempDLM monitors the Downloads folder and presents a non-intrusive dialog when new files appear, allowing users to set a deletion timer from preset options (5 minutes to "never") or specify a custom duration. Files are moved to the Recycle Bin when their timer expires, allowing recovery if needed. A management interface provides visibility into scheduled deletions and control over the queue.

## Target Users

### Primary Persona: The Productive Professional

- Downloads many files daily (documents, images, installers)
- Values a clean, organized system
- Doesn't want to think about file management
- Needs quick, frictionless interactions

### Secondary Persona: The Storage-Conscious User

- Has limited disk space (laptop, older hardware)
- Actively manages storage but finds it tedious
- Wants automation that respects their preferences

### Tertiary Persona: The Privacy-Aware User

- Downloads sensitive documents (financial, medical, legal)
- Wants assurance that temporary files don't persist
- Values the Recycle Bin safety net

## Core Value Proposition

**"Set it and forget it" file cleanup that respects user intent.**

Unlike bulk auto-delete tools, TempDLM:

1. **Asks at the right moment** - when the file arrives, context is fresh
2. **Respects file-by-file decisions** - not one-size-fits-all rules
3. **Provides safety nets** - Recycle Bin, snooze for in-use files, whitelist
4. **Stays out of the way** - system tray presence, minimal interruption

## Success Metrics

### User Experience Metrics

- Time from download to timer-set decision: < 3 seconds
- Dialog dismissal rate without action: < 10%
- User-reported satisfaction with defaults: > 80%

### Technical Metrics

- System resource usage: < 50MB RAM, < 1% CPU idle
- File detection latency: < 500ms from file creation
- Startup time: < 2 seconds to tray

### Adoption Metrics

- Installation completion rate: > 90%
- 30-day retention rate: > 70%
- User-initiated uninstall rate: < 15%

## Scope

### In Scope (MVP - Phase 1)

- Windows 10/11 support
- Downloads folder monitoring with configurable path
- New file detection dialog with timer options (5m, 30m, 2h, 1d, Never, Custom)
- Recycle Bin deletion (not permanent)
- Main window with deletion queue
- Search, sort, and edit functionality for queue
- System tray icon with quick actions
- "File in use" detection with snooze/cancel options
- Persist queue across app restarts
- Startup with Windows option
- Basic whitelist by file extension

### In Scope (Phase 2)

- macOS support
- Pattern-based whitelist (regex, wildcards)
- Download clustering (group files from same event)
- Statistics dashboard (files managed, space saved)
- Keyboard shortcuts
- Custom notification sounds
- Dark/light theme

### In Scope (Phase 3)

- Linux support
- Browser extension integration (optional)
- Multiple folder monitoring
- Cloud sync of preferences
- Localization (i18n)

### Out of Scope (Not Planned)

- Browser download interception (see Key Assumptions)
- Cloud storage integration
- File compression or archiving
- Duplicate file detection
- File content analysis
- Mobile companion apps

## Key Assumptions

### Technical Assumptions

1. **File system monitoring is sufficient** - We assume watching the Downloads folder for new files provides adequate detection without needing browser integration
2. **Recycle Bin API is reliable** - Platform APIs for moving to trash work consistently across supported OS versions
3. **Single user context** - The app runs for one user account at a time

### User Behavior Assumptions

1. Users will respond to dialogs promptly (within 10 seconds)
2. Default timer options cover 80%+ of use cases
3. Users prefer Recycle Bin over permanent deletion
4. Most users have a single primary Downloads folder

### Business Assumptions

1. CC BY-NC-ND 4.0 (Source-Available) license — personal use permitted, no derivatives or commercial use
2. No monetization required for v1
3. Single developer can maintain the project

## Risks and Unknowns

### High Risk

| Risk                                   | Impact                              | Mitigation                                                          |
| -------------------------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| Accidental deletion of important files | User data loss, reputation damage   | Always use Recycle Bin, confirm on sensitive types, undo capability |
| Dialog fatigue from frequent downloads | Users disable app or ignore dialogs | Smart defaults, "Remember for this type" option, batch dialogs      |
| Performance impact from file watching  | System slowdown, battery drain      | Efficient polling/event-based watching, configurable intervals      |

### Medium Risk

| Risk                                   | Impact                           | Mitigation                                                |
| -------------------------------------- | -------------------------------- | --------------------------------------------------------- |
| Cross-platform complexity delays MVP   | Extended timeline, scope creep   | Start Windows-only, clean abstraction layer for future    |
| File locking conflicts with other apps | Failed deletions, user confusion | Robust retry logic, clear messaging, snooze functionality |
| Installer/distribution challenges      | Adoption barriers                | Use established tooling (Electron Forge, NSIS)            |

### Unknowns to Investigate

1. **Optimal polling interval** - Balance between responsiveness and resource usage
2. **Dialog positioning strategy** - Where to show without interrupting workflow
3. **Whitelist UX** - How to make pattern configuration accessible to non-technical users

## "Catch Before Download" Analysis

### User Request

The user expressed interest in catching downloads BEFORE they land in the Downloads folder, potentially intercepting the browser's download process.

### Feasibility Assessment

**Not Recommended for MVP. Here's why:**

1. **Browser Sandboxing**: Modern browsers (Chrome, Firefox, Edge) are heavily sandboxed. There is no standard API to intercept downloads before they complete.

2. **Browser Extension Requirement**: The only reliable way to catch downloads pre-completion is through browser-specific extensions:
   - Chrome: `chrome.downloads` API
   - Firefox: `browser.downloads` API
   - Each browser needs separate extension development and maintenance

3. **Complexity vs Value**:
   - Extensions require separate publishing to browser stores
   - Users must install both desktop app AND browser extension
   - Extensions need ongoing maintenance for browser updates
   - The UX benefit is marginal (dialog appears during download vs after)

4. **Alternative Approaches** (evaluated and rejected):
   - Network proxy interception: Breaks HTTPS, security nightmare
   - Browser profile modification: Unreliable, varies by browser
   - Process monitoring: Can detect browser download processes but not intercept

### Recommendation

**Use file system watching for MVP.** The dialog will appear within 500ms of file completion, which is imperceptible for most downloads and only seconds behind for large files. If user feedback strongly demands pre-download interception, consider a Phase 3 optional browser extension.

## Next Steps

1. Finalize technology stack decision (see specifications.md)
2. Create detailed technical architecture
3. Design UI/UX mockups for core flows
4. Set up development environment and CI/CD
5. Implement Phase 1 MVP with Windows support
