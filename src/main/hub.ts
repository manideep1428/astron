import { WebSocketServer, WebSocket } from 'ws'
import { randomBytes } from 'crypto'
import type { AgentEvent } from './agent/types'

export type HubMsg =
  | { kind: 'hello'; client: string; port?: number }
  | { kind: 'agent-event'; event: AgentEvent }
  | { kind: 'rpc-request'; id: string; method: string; params?: unknown }
  | { kind: 'rpc-response'; id: string; ok: boolean; data?: unknown; error?: string }
  | { kind: 'voice-chunk'; seq: number; audio: string; sampleRate?: number }
  | { kind: 'voice-state'; state: string; text?: string }

type RpcHandler = (params: unknown) => Promise<unknown> | unknown
type VoiceChunkHandler = (seq: number, audioB64: string, sampleRate: number) => void

const PREFERRED_PORTS = [44517, 44518, 44519, 44777]

class SocketHub {
  private wss: WebSocketServer | null = null
  private clients = new Set<WebSocket>()
  private handlers = new Map<string, RpcHandler>()
  private voiceHandlers = new Set<VoiceChunkHandler>()
  private token = randomBytes(24).toString('hex')
  port = 0

  getToken(): string {
    return this.token
  }

  onRpc(method: string, fn: RpcHandler): void {
    this.handlers.set(method, fn)
  }

  onVoiceChunk(fn: VoiceChunkHandler): () => void {
    this.voiceHandlers.add(fn)
    return () => {
      this.voiceHandlers.delete(fn)
    }
  }

  broadcastVoiceState(state: string, text?: string): void {
    this.broadcast({ kind: 'voice-state', state, text })
  }

  broadcast(obj: HubMsg): void {
    if (this.clients.size === 0) return
    const raw = JSON.stringify(obj)
    for (const c of this.clients) {
      try {
        if (c.readyState === WebSocket.OPEN) c.send(raw)

  }
}
export const socketHub = new SocketHub()
