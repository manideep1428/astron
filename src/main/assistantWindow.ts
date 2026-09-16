import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { toAudioBuffer } from './audioPayload'
import { transcribeAudio } from './stt'
import { orchestrator } from './agent/orchestrator'

let win: BrowserWindow | null = null
let held = false
let session = 0
let submitted = 0
let busy = false
let limit: ReturnType<typeof setTimeout> | undefined

export function assistantIsHeld(): boolean { return held }

export function createAssistantWindow(): void {
  if (win && !win.isDestroyed()) return
  const area = screen.getPrimaryDisplay().workArea
  win = new BrowserWindow({
    width: 300, height: 130, x: area.x + Math.round((area.width - 300) / 2),
    y: area.y + area.height - 155, show: false, frame: false, transparent: true,
    alwaysOnTop: true, focusable: false, skipTaskbar: true, resizable: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false,
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  })
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.on('closed', () => { held = false; clearTimeout(limit); win = null })
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/index.html?window=assistant`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: 'assistant' } })
  }
}

function notify(): void {
  win?.webContents.send('assistant:hold', { held, session })
}

export function startAssistant(): void {
  if (held || busy) return
  createAssistantWindow()
  held = true
  session += 1
  win?.showInactive()
  notify()
  clearTimeout(limit)
  limit = setTimeout(stopAssistant, 60_000)
}

export function stopAssistant(): void {
  if (!held) return
  held = false
  clearTimeout(limit)
  notify()
}

export function registerAssistantIpc(): void {
  ipcMain.handle('assistant:state', (event) => {
    if (event.sender !== win?.webContents) throw new Error('Invalid assistant window')
    return { held, session }
  })
  ipcMain.handle('assistant:dismiss', (event) => {
    if (event.sender !== win?.webContents) return
    held = false
    clearTimeout(limit)
    submitted = session
    notify()

}
