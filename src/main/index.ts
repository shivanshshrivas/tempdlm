import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } from 'electron'
import path from 'path'
import { IPC_INVOKE, IPC_EVENTS, UserSettings, QueueItem, SetTimerPayload, CancelPayload, SnoozePayload } from '../shared/types'

// ─── Dev mode helper ─────────────────────────────────────────────────────────

const isDev = !app.isPackaged

// ─── Window references ────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

// ─── Create main window ───────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    title: 'TempDLM',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Hide to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
}

// ─── System tray ─────────────────────────────────────────────────────────────

function createTray() {
  // Placeholder icon — replace with actual asset before shipping
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('TempDLM')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open TempDLM',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)

  tray.on('double-click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

function registerIpcHandlers() {
  ipcMain.handle(IPC_INVOKE.QUEUE_GET, async (): Promise<QueueItem[]> => {
    // TODO: return from store
    return []
  })

  ipcMain.handle(IPC_INVOKE.SETTINGS_GET, async (): Promise<UserSettings> => {
    // TODO: return from electron-store
    return {
      downloadsFolder: app.getPath('downloads'),
      launchAtStartup: false,
      defaultTimer: '30m',
      customDefaultMinutes: 60,
      theme: 'system',
      showNotifications: true,
      dialogPosition: 'bottom-right',
      whitelistRules: [],
    }
  })

  ipcMain.handle(IPC_INVOKE.SETTINGS_UPDATE, async (_event, settings: Partial<UserSettings>) => {
    // TODO: persist to electron-store
    console.log('settings:update', settings)
  })

  ipcMain.handle(IPC_INVOKE.FILE_SET_TIMER, async (_event, payload: SetTimerPayload) => {
    // TODO: schedule deletion
    console.log('file:set-timer', payload)
  })

  ipcMain.handle(IPC_INVOKE.FILE_CANCEL, async (_event, payload: CancelPayload) => {
    // TODO: cancel scheduled deletion
    console.log('file:cancel', payload)
  })

  ipcMain.handle(IPC_INVOKE.FILE_SNOOZE, async (_event, payload: SnoozePayload) => {
    // TODO: snooze deletion
    console.log('file:snooze', payload)
  })
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

app.whenReady().then(() => {
  createMainWindow()
  createTray()
  registerIpcHandlers()
})

app.on('window-all-closed', (event: Electron.Event) => {
  // Keep app running in tray on all platforms
  event.preventDefault()
})

app.on('activate', () => {
  mainWindow?.show()
})

// Extend app type for quit flag
declare module 'electron' {
  interface App {
    isQuitting: boolean
  }
}
app.isQuitting = false
