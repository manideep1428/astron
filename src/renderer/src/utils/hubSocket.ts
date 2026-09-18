/**
 * Immediate-connect WebSocket client for the local hub.
 * Renderer connects on boot (no polling): agent events stream in,
 * RPC calls resolve over the same socket, voice chunks can ride it too.
 */

export interface WsAgentEvent {
  runId: string
  agentId?: string
  type: string
  status?: string
  progress?: number
  currentAction?: string
  text?: string
  screenshot?: string
  error?: string
  at: number
}

type Listener = (ev: WsAgentEvent) => void
type StateListener = (state: string) => void

class HubSocket {
  private ws: WebSocket | null = null
  private url = ''
  private listeners = new Set<Listener>()
  private stateListeners = new Set<StateListener>()
  private helloListeners = new Set<(port: number) => void>()
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private seq = 0
  private retries = 0
  private closed = false
  private connectTimer: number | null = null
  status: 'idle' | 'connecting' | 'open' | 'failed' = 'idle'

  onEvent(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  onVoiceState(fn: StateListener): () => void {
    this.stateListeners.add(fn)
    return () => {
      this.stateListeners.delete(fn)
    }
  }

  onHello(fn: (port: number) => void): () => void {
    this.helloListeners.add(fn)
    return () => {
      this.helloListeners.delete(fn)
    }
  }

  /** Connect immediately; retries with backoff until main hub is up. */
  connect(): void {
    if (this.ws || this.status === 'connecting') return
    this.closed = false
    this.status = 'connecting'
    void this.tryConnect()
  }

  disconnect(): void {
    this.closed = true
    if (this.connectTimer) window.clearTimeout(this.connectTimer)
    try {
      this.ws?.close()
    } catch {
      // ignore
    }
    this.ws = null
    this.status = 'idle'
  }

  private async tryConnect(): Promise<void> {
    if (this.closed) return
    try {
      const info = await window.astronApi.getHubInfo()
      if (!info.port) throw new Error('hub not ready')
      this.url = `ws://127.0.0.1:${info.port}?token=${encodeURIComponent(info.token)}`
    } catch {
      return this.retry()
    }
    try {
      const ws = new WebSocket(this.url)
      this.ws = ws
      ws.onopen = () => {
        this.retries = 0
        this.status = 'open'
      }
      ws.onmessage = (e) => this.handle(String(e.data))
      ws.onclose = () => {
        this.ws = null
        if (!this.closed) {
          this.status = 'connecting'
          this.retry()
        } else {
          this.status = 'idle'
        }
      }
      ws.onerror = () => {
        try {
          ws.close()
        } catch {
          // ignore
        }
      }
    } catch {
      this.retry()
    }
  }

  private retry(): void {
    if (this.closed) return
    this.ws = null
    this.retries += 1
    const delay = Math.min(200 * this.retries, 2000)
    if (this.connectTimer) window.clearTimeout(this.connectTimer)
    this.connectTimer = window.setTimeout(() => void this.tryConnect(), delay)
  }

  private handle(raw: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }
    const kind = String(msg.kind ?? '')
    if (kind === 'hello') {
      const port = Number(msg.port ?? 0)
      for (const fn of this.helloListeners) {
        try {
          fn(port)
        } catch {
          // ignore
        }
      }
      return
    }
    if (kind === 'agent-event') {
      const ev = msg.event as WsAgentEvent
      for (const fn of this.listeners) {
        try {
          fn(ev)
        } catch {
          // ignore listener errors
        }
      }
      return
    }
    if (kind === 'voice-state') {
      const state = String(msg.state ?? 'idle')
      const text = typeof msg.text === 'string' ? msg.text : ''
      for (const fn of this.stateListeners) {
        try {
          fn(text ? `${state}::${text}` : state)
        } catch {
          // ignore
        }
      }
      return
    }
    if (kind === 'rpc-response') {
      const id = String(msg.id ?? '')
      const p = this.pending.get(id)
      if (!p) return
      this.pending.delete(id)
      if (msg.ok) p.resolve(msg.data)
      else p.reject(new Error(String(msg.error ?? 'rpc failed')))
    }
  }

  rpc<T>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('socket not connected yet'))
    }
    this.seq += 1
    const id = `r${Date.now().toString(36)}_${this.seq}`
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject
      })
      window.setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`))
      }, timeoutMs)
      try {
        this.ws?.send(JSON.stringify({ kind: 'rpc-request', id, method, params }))
      } catch (e) {
        this.pending.delete(id)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  sendVoiceChunk(seq: number, audio: string, sampleRate?: number): void {
    try {
      this.ws?.send(JSON.stringify({ kind: 'voice-chunk', seq, audio, sampleRate }))
    } catch {
      // drop chunk rather than break mic loop
    }
  }
}

export const hubSocket = new HubSocket()
