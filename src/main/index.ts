import { app, shell, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { configManager } from './config'
import { hotkeyManager } from './hotkey'
import { orchestrator } from './agent/orchestrator'
import { readTrace } from './agent/trace'
import { socketHub } from './hub'
import { attachVoiceSession } from './voiceSession'
import { createHubWindow, registerHubWindowIpc } from './hubWindow'
import { assistantIsHeld, createAssistantWindow, registerAssistantIpc, startAssistant, stopAssistant } from './assistantWindow'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let singleInstance = false

// Branding: keep the runtime name correct in dev too (packaged builds get
// this from electron-builder's productName, dev does not).
app.setName('Astron')

// The Ctrl + Win + A listener is global. A second copy must quit before it
// creates a second tray icon, a second listener, and a second websocket hub.
singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    } else {
      mainWindow = createMainWindow()
    }
  })
}

async function handleAgentCreateWs(p: unknown): Promise<unknown> {
  const req = (p ?? {}) as { task?: string; count?: number; mode?: 'ask' | 'my-computer' | 'detached' | 'auto'; execution?: 'sequential' | 'parallel' }
  const task = String(req.task ?? '').trim()
  if (!task) throw new Error('Task is empty.')
  return orchestrator.createRun({
    task,
    mode: req.mode,
    count: typeof req.count === 'number' ? Math.max(1, Math.min(5, req.count)) : undefined,
    execution: req.execution
  })
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Astron',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
    configManager.save({ hasOpenedDashboard: true })
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    mainWindow = null
  })

  return win
}

function toggleAssistantFromUi(): void {
  if (assistantIsHeld()) stopAssistant()
  else startAssistant()
}

function createTray(): void {
