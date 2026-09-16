/**
 * Live voice session over the local WS hub.
 * - Renderer streams 16kHz PCM base64 chunks instantly (no per-chunk IPC).
 * - Main buffers ~1.2s windows, transcribes them with OpenAI, and answers with
 *   the same GPT model the voice assistant uses (text path; full-duplex audio
 *   out rides back as voice-state events).
 */
import { socketHub } from './hub'
import { configManager } from './config'
import { transcribeAudio } from './stt'

const WINDOW_MS = 1200
const MAX_CHUNKS = 400

let attached = false
let chunks: Buffer[] = []
let windowStart = 0
let busy = false

function pcmB64ToWav(b64: string): Buffer | null {
  try {
    const pcm = Buffer.from(b64, 'base64')
    if (pcm.length === 0 || pcm.length % 2 !== 0) return null
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + pcm.length, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(1, 22)
    header.writeUInt32LE(16000, 24)
    header.writeUInt32LE(16000 * 2, 28)
    header.writeUInt16LE(2, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36)
    header.writeUInt32LE(pcm.length, 40)
    return Buffer.concat([header, pcm])
  } catch {
    return null
  }
}

async function astraReply(prompt: string): Promise<string | null> {
  const key =
    configManager.get().openaiApiKey?.trim() ||
    (process.env.OPENAI_API_KEY || process.env.GPT_API_KEY || '').trim()
  if (!key) return null
  const model = (process.env.OPENAI_MODEL || process.env.GPT_MODEL || 'gpt-4.1-mini').trim()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          instructions: 'Voice of Astron AI computer. 1-2 short spoken sentences.',
          input: prompt.slice(0, 2000),
          max_output_tokens: 220
        })
      })
      if (!res.ok) return null
      const json = (await res.json()) as { output_text?: string }
      return String(json.output_text ?? '').trim() || null
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

function looksLikeCommand(text: string): boolean {
  return /^(research|compare|search|open|build|test|fix|run|summar|write|create|check|find)\b/i.test(text.trim())
}

async function transcribeWindow(full: Buffer, pcmLen: number): Promise<void> {
  if (busy) return
  busy = true
  try {
    const seconds = pcmLen / 2 / 16000
    socketHub.broadcastVoiceState('transcribing')
    const result = await transcribeAudio(full, Math.round(seconds * 1000))
    if (!result.success || !result.text.trim()) {
      socketHub.broadcastVoiceState('idle')
      return
    }
    const text = result.text.trim()
    // Live voice uses the same GPT path as the voice assistant: transcribe,
    // answer with the model, and hand command-like speech to an agent run.
    const reply = await astraReply(text)
    if (reply) {
      socketHub.broadcastVoiceState('speaking', reply)
      if (looksLikeCommand(text)) {
        try {
          const { orchestrator } = await import('./agent/orchestrator')
          await orchestrator.createRun({ task: text, count: 2 })
        } catch {
          // reply already sent
        }
      }
      return
    }
    socketHub.broadcastVoiceState('idle', text)
  } finally {
    busy = false
  }
}

/** Attach once at boot: WS voice chunks -> buffered STT/GPT loop. */
export function attachVoiceSession(): void {
  if (attached) return
  attached = true
  socketHub.onVoiceChunk((_seq, audioB64) => {
    void _seq
    const wav = pcmB64ToWav(audioB64)
    if (!wav) return
    const now = Date.now()
    if (windowStart === 0) windowStart = now
    chunks.push(wav.subarray(44))
    if (chunks.length > MAX_CHUNKS) chunks.splice(0, chunks.length - MAX_CHUNKS)
    if (now - windowStart >= WINDOW_MS && !busy) {
      windowStart = now
      const parts = chunks
      chunks = []
      const pcmLen = parts.reduce((n, c) => n + c.length, 0)
      const header = Buffer.alloc(44)
      header.write('RIFF', 0)
      header.writeUInt32LE(36 + pcmLen, 4)
      header.write('WAVE', 8)
      header.write('fmt ', 12)
      header.writeUInt32LE(16, 16)
      header.writeUInt16LE(1, 20)
      header.writeUInt16LE(1, 22)
      header.writeUInt32LE(16000, 24)
      header.writeUInt32LE(16000 * 2, 28)
      header.writeUInt16LE(2, 32)
      header.writeUInt16LE(16, 34)
      header.write('data', 36)
      header.writeUInt32LE(pcmLen, 40)
      void transcribeWindow(Buffer.concat([header, ...parts]), pcmLen)
    }
  })
}


