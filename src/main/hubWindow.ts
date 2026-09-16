import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

let hubWindow: BrowserWindow | null = null
let expanded = false
let agentCount = 0

function positionHub(): void {
  if (!hubWindow || hubWindow.isDestroyed()) return
  const area = screen.getPrimaryDisplay().workArea
  const columns = Math.max(1, Math.min(11, Math.floor((area.width - 34) / 32)))
  const width = Math.min(expanded ? 380 : Math.min(Math.max(1, agentCount), columns) * 32 + 10, area.width)
  const height = Math.min(expanded ? 580 : Math.ceil(Math.max(1, agentCount) / columns) * 32 + 10, area.height)
  hubWindow.setBounds({
    x: area.x + area.width - width - 12,
    y: area.y + 12,
    width,
    height
  })
}

export function createHubWindow(): BrowserWindow {
  if (hubWindow && !hubWindow.isDestroyed()) return hubWindow
  expanded = false
  const win = new BrowserWindow({
    width: 64, height: 64, frame: false, transparent: true,
    alwaysOnTop: true, focusable: false, skipTaskbar: true,
    resizable: false, hasShadow: false, show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false, contextIsolation: true, nodeIntegration: false
    }
  })
  hubWindow = win
  positionHub()
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.once('ready-to-show', () => {
    if (agentCount > 0) win.showInactive()
  })
  screen.on('display-metrics-changed', positionHub)
  screen.on('display-removed', positionHub)
  win.on('closed', () => {
    screen.removeListener('display-metrics-changed', positionHub)
    screen.removeListener('display-removed', positionHub)
    hubWindow = null
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/index.html?window=agent-hub`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: 'agent-hub' } })
  }
  return win
}

export function registerHubWindowIpc(): void {
  ipcMain.handle('hub:set-agent-count', (event, count: number) => {
    if (event.sender !== hubWindow?.webContents || !Number.isSafeInteger(count) || count < 0) return
    agentCount = count
    if (!count) {
      expanded = false
      hubWindow?.hide()
    }
    positionHub()
    if (count && !hubWindow?.isVisible()) hubWindow?.showInactive()
  })
  ipcMain.handle('hub:set-expanded', (event, value: boolean) => {
    if (event.sender !== hubWindow?.webContents || typeof value !== 'boolean') return
    expanded = value && agentCount > 0
    positionHub()
  })
}
