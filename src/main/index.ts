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
  try {
    const trayIcon = nativeImage.createFromPath(icon)
    tray = new Tray(trayIcon.resize({ width: 16, height: 16 }))
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Astron',
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Hold to Talk (same as Ctrl + Win + A)',
        click: () => startAssistant()
      },
      {
        label: 'Start / Finish Voice Task',
        click: () => toggleAssistantFromUi()
      },
      {
        label: 'Open Dashboard',
        click: () => {
          if (!mainWindow) {
            mainWindow = createMainWindow()
          } else {
            mainWindow.show()
            mainWindow.focus()
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.quit()
        }
      }
    ])
    tray.setToolTip('Astron - AI agent assistant')
    tray.setContextMenu(contextMenu)
    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
      } else {
        mainWindow = createMainWindow()
      }
    })
  } catch (err) {
    console.warn('Tray creation skipped/failed:', err)
  }
}

app.whenReady().then(() => {
  if (!singleInstance) return
  electronApp.setAppUserModelId('com.astron.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Local WebSocket hub: connects immediately on renderer boot, streams
  // agent events + carries voice chunks for GPT-Live-1 style full-duplex.
  void socketHub.start().then((port) => {
    attachVoiceSession()
    socketHub.onRpc('agent:create', (p) => handleAgentCreateWs(p))
    socketHub.onRpc('agent:list', () => orchestrator.listRuns())
    socketHub.onRpc('agent:pause', (p) => {
      orchestrator.pauseRun(String((p as { runId?: string })?.runId ?? p ?? ''))
      return { ok: true }
    })
    socketHub.onRpc('agent:resume', (p) => {
      orchestrator.resumeRun(String((p as { runId?: string })?.runId ?? p ?? ''))
      return { ok: true }
    })
    socketHub.onRpc('agent:cancel', (p) => {
      orchestrator.cancelRun(String((p as { runId?: string })?.runId ?? p ?? ''))
      return { ok: true }
    })
    socketHub.onRpc('voice:state', (p) => {
      const state = String((p as { state?: string })?.state ?? 'idle')
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          if (!win.isDestroyed()) win.webContents.send('voice:ws-state', state)
        } catch {
          // ignore
        }
      }
      return { ok: true, port }
    })
    console.log(`[hub] rpc ready on :${port}`)
  }).catch((err) => console.warn('[hub] failed to start', err))

  // Register IPC Handlers
  ipcMain.handle('get-config', () => {
    return configManager.get()
  })

  ipcMain.handle('save-config', (_, newConfig) => {
    return configManager.save(newConfig)
  })

  ipcMain.handle('show-dashboard', () => {
    if (!mainWindow) {
      mainWindow = createMainWindow()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  ipcMain.handle('agent:create', async (_, req) => {
    const task = String(req?.task ?? '').trim()
    if (!task) throw new Error('Task is empty.')
    const count =
      typeof req?.count === 'number' ? Math.max(1, Math.min(5, req.count)) : undefined
    const run = await orchestrator.createRun({
      task,
      mode: req?.mode,
      count,
      execution: req?.execution
    })
    return run
  })

  ipcMain.handle('agent:list', () => orchestrator.listRuns())

  ipcMain.handle('agent:pause', (_, runId: string) => {
    orchestrator.pauseRun(String(runId))
  })

  ipcMain.handle('agent:resume', (_, runId: string) => {
    orchestrator.resumeRun(String(runId))
  })

  ipcMain.handle('agent:cancel', (_, runId: string) => {
    orchestrator.cancelRun(String(runId))
  })

  ipcMain.handle('agent:approve', (_, runId: string, agentId: string) => {
    orchestrator.approveAgent(String(runId), String(agentId))
  })

  ipcMain.handle('agent:get-settings', () => {
    const saved = configManager.get().computerUse
    return orchestrator.updateSettings({ ...saved })
  })

  ipcMain.handle('agent:save-settings', (_, patch) => {
    const next = orchestrator.updateSettings(patch ?? {})
    configManager.save({ computerUse: next })
    return next
  })

  ipcMain.handle('agent:get-trace', (_, runId: string) => readTrace(String(runId)))

  ipcMain.handle('hub:info', () => ({ port: socketHub.port, token: socketHub.getToken() }))

  registerHubWindowIpc()
  registerAssistantIpc()
  // Dashboard is opt-in after the first launch; overlays own background UI.
  if (!configManager.get().hasOpenedDashboard) {
    mainWindow = createMainWindow()
  }
  createAssistantWindow()
  createHubWindow()
  createTray()
  try {
    const saved = configManager.get().computerUse
    if (saved) orchestrator.updateSettings({ ...saved })
  } catch {
    // defaults stand
  }

  // Start the Ctrl + Win + A voice-task listener
  hotkeyManager.start({
    onAssistantPress: () => startAssistant(),
    onAssistantRelease: () => stopAssistant(),
    onAssistantToggle: () => toggleAssistantFromUi()
  })

  app.on('activate', function () {
    if (!mainWindow) mainWindow = createMainWindow()
    else { mainWindow.show(); mainWindow.focus() }
  })
})

app.on('will-quit', () => {
  hotkeyManager.stop()
})

app.on('window-all-closed', () => {
  // Keep running in tray / background for hotkeys
})
