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

}
