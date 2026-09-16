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
