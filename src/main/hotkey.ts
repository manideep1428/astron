import { app, globalShortcut } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { spawn, ChildProcess } from 'child_process'

export interface HotkeyHandlers {
  /** Ctrl + Win + A went down: open the assistant card and start listening. */
  onAssistantPress: () => void
  /** Ctrl + Win + A was let go: stop listening and send the voice task. */
  onAssistantRelease: () => void
  /** Toggle callback for the tray/UI, where the live session state decides. */
  onAssistantToggle: () => void
}

/** How long the listener may take to announce itself before it is reported. */
const READY_TIMEOUT_MS = 8000
const RESTART_BASE_DELAY_MS = 1500
const RESTART_MAX_DELAY_MS = 30000

/**
 * Watches for the Ctrl + Win + A voice-task chord.
 *
 * The listener process prints one line per state change on stdout:
 *   LISTENER_READY | ASSISTANT_PRESS | ASSISTANT_RELEASE
 * so a hold and its release always produce exactly one press event and one
 * release event, which is what push-to-talk needs.
 */
export class HotkeyManager {
  private listenerProcess: ChildProcess | null = null
  private handlers: HotkeyHandlers | null = null
  private stdoutBuffer = ''
  private stopped = true
  private ready = false
  private spawnedAt = 0
  private failures = 0
  private readyTimer: NodeJS.Timeout | null = null
  private restartTimer: NodeJS.Timeout | null = null

  public start(handlers: HotkeyHandlers): void {
    this.handlers = handlers
    this.stopped = false
    this.failures = 0
    if (process.platform === 'darwin') {
      this.registerMacShortcuts()
    } else {
      this.spawnNativeHook()
    }
  }

  public stop(): void {
    this.stopped = true
    this.clearReadyTimer()

    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }

    try {
      globalShortcut.unregisterAll()
    } catch {
      // ignore
    }

    const process_ = this.listenerProcess
    this.listenerProcess = null

    if (process_) {
      try {
        process_.kill()
      } catch {
        // ignore
      }
    }
  }

  private spawnNativeHook(): void {
    const command = this.resolveListenerCommand()

    if (!command) {
      console.warn('[hotkey] no native Ctrl + Win + A listener found - voice tasks need the tray menu.')
      return
    }

    try {
      this.stdoutBuffer = ''
      this.ready = false
      this.spawnedAt = Date.now()

      this.listenerProcess = spawn(command.file, command.args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      this.armReadyTimer()

      this.listenerProcess.stdout?.on('data', (chunk: Buffer) => this.handleStdout(chunk))
      this.listenerProcess.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim()
        if (text) console.warn('[hotkey] listener:', text)
      })
      this.listenerProcess.on('error', (err) => {
        console.warn('[hotkey] listener process error:', err)
      })
      this.listenerProcess.on('exit', (code) => this.handleExit(code))
    } catch (err) {
      console.error('[hotkey] failed to spawn the listener:', err)
      this.listenerProcess = null
      this.scheduleRestart()
    }
  }

  /** A spawn that throws outright still needs a retry instead of going silent. */
  private scheduleRestart(): void {
    if (this.stopped || this.restartTimer) return
    this.failures += 1
    const delay = Math.min(RESTART_BASE_DELAY_MS * Math.max(1, this.failures), RESTART_MAX_DELAY_MS)
    console.warn(`[hotkey] listener unavailable; retrying in ${delay}ms`)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.stopped) {
        this.spawnNativeHook()
      }
    }, delay)
  }
  private resolveListenerCommand(): { file: string; args: string[] } | null {
    if (process.platform !== 'win32') {
      return null
    }

    // Always use the shared shortcut script; old executables only understand
    // Ctrl+Win and cannot detect the assistant chord.
    const script = this.firstExisting([
      join(process.resourcesPath, 'resources', 'assistant_hotkeys.ps1'),
      join(app.getAppPath(), 'resources', 'assistant_hotkeys.ps1'),
      join(__dirname, '../../resources', 'assistant_hotkeys.ps1')
    ])
    if (script) {
      return {
        file: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script]
      }
    }

    return null
  }

  private firstExisting(paths: string[]): string | null {
    for (const candidate of paths) {
      try {
        if (candidate && existsSync(candidate)) {
          return candidate
        }
      } catch {
        // ignore unreadable paths
      }
    }
    return null
  }

  /** stdout is a stream, so events can be split across chunks - buffer by line. */
  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString('utf8')

    let newlineIndex = this.stdoutBuffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '').trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)
      this.handleLine(line)
      newlineIndex = this.stdoutBuffer.indexOf('\n')
    }

    if (this.stdoutBuffer.length > 8192) {
      this.stdoutBuffer = ''
    }
  }

  private handleLine(line: string): void {
    if (!line) return

    if (line.includes('LISTENER_READY')) {
      this.markReady()
      return
    }
    if (line === 'ASSISTANT_PRESS') {
      console.log('[hotkey] Ctrl + Win + A pressed - opening voice task')
      this.handlers?.onAssistantPress()
      return
    }
    if (line === 'ASSISTANT_RELEASE') {
      console.log('[hotkey] Ctrl + Win + A released - finishing voice task')
      this.handlers?.onAssistantRelease()
      return
    }
    if (line.includes('HOOK_FAILED')) {
      console.warn('[hotkey] listener could not install the keyboard hook:', line)
      return
    }

    console.log('[hotkey] listener:', line)
  }

  private markReady(): void {
    if (this.ready) return
    this.ready = true
    this.failures = 0
    this.clearReadyTimer()
    console.log('[hotkey] Ctrl + Win + A voice-task listener ready')
  }

  private handleExit(code: number | null): void {
    // A dead listener can never report the release, so close the session.
    this.handlers?.onAssistantRelease()
    this.clearReadyTimer()
    this.listenerProcess = null

    if (this.ready) {
      this.failures = 0
    }
    this.ready = false

    if (this.stopped) return

    const lived = Date.now() - this.spawnedAt
    if (lived < 5000) {
      this.failures += 1
    } else {
      this.failures = 0
    }

    const delay = Math.min(RESTART_BASE_DELAY_MS * Math.max(1, this.failures), RESTART_MAX_DELAY_MS)
    console.warn(`[hotkey] listener exited (code ${code}); restarting in ${delay}ms`)

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.stopped) {
        this.spawnNativeHook()
      }
    }, delay)
  }

  private armReadyTimer(): void {
    this.clearReadyTimer()
    this.readyTimer = setTimeout(() => {
      this.readyTimer = null
      if (this.ready || this.stopped) return
      console.warn('[hotkey] listener did not report ready in time; voice tasks need the tray menu.')
    }, READY_TIMEOUT_MS)
  }

  private clearReadyTimer(): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer)
      this.readyTimer = null
    }
  }

  private registerMacShortcuts(): void {
    // Electron globalShortcut has no key-up events: use an explicit toggle gesture.
    const shortcuts: Array<[string, () => void]> = [
      ['Control+Command+A', () => this.handlers?.onAssistantToggle()]
    ]
    for (const [shortcut, handler] of shortcuts) {
      try {
        if (!globalShortcut.register(shortcut, handler)) {
          console.warn(`[hotkey] macOS shortcut unavailable: ${shortcut}; use the tray controls.`)
        }
      } catch (error) {
        console.warn(`[hotkey] could not register ${shortcut}:`, error)
      }
    }
  }
}

export const hotkeyManager = new HotkeyManager()
