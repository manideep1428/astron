import { configManager, DEFAULT_STT_URL } from './config'

export interface STTResult {
  success: boolean
  text: string
  error?: string
  durationMs: number
}

/** OpenAI rejects anything slower than this, so we fail fast instead of hanging the pill. */
const REQUEST_TIMEOUT_MS = 60_000

/**
 * OpenAI speech-to-text model. `gpt-4o-mini-transcribe` keeps voice tasks fast;
 * override with OPENAI_TRANSCRIBE_MODEL (for example `whisper-1`).
 */
export function transcribeModel(): string {
  return (process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe').trim()
}

/** Saved key wins; environment credentials are the fallback for headless runs. */
function resolveApiKey(): string {
  return (
    configManager.get().openaiApiKey?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.GPT_API_KEY?.trim() ||
    ''
  )
}

/** Keys that are never actual transcripts - used by the defensive fallback extractor. */
const NON_TRANSCRIPT_KEYS = new Set([
  'status',
  'id',
  'code',
  'error',
  'message',
  'language',
  'model',
  'request_id',
  'requestid'
])

/**
 * Sends the recorded WAV to the OpenAI transcription endpoint and returns the
 * transcript. `recordingDurationMs` is the real time the user held the hotkey
 * (the API latency is not part of it).
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  recordingDurationMs?: number
): Promise<STTResult> {
  const startTime = Date.now()
  const config = configManager.get()
  const key = resolveApiKey()

  if (!key) {
    return {
      success: false,
      text: '',
      error: 'Please enter your OpenAI API key in Settings to transcribe.',
      durationMs: 0
    }
  }

  if (!audioBuffer || audioBuffer.byteLength === 0) {
    return {
      success: false,
      text: '',
      error: 'No audio was recorded. Hold Ctrl + Win and speak.',
      durationMs: 0
    }
  }

  const lang = config.language || process.env.OPENAI_LANGUAGE || 'en'
  const url = config.apiUrl?.trim() || DEFAULT_STT_URL
  const model = transcribeModel()
  const { body, contentType } = buildMultipartBody(
    { model, response_format: 'json', ...(lang ? { language: lang } : {}) },
    audioBuffer
  )

  console.log(
    `[stt] POST ${url} (${audioBuffer.byteLength} bytes, ${Math.round(recordingDurationMs ?? 0)}ms of speech, model=${model})`
  )

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': contentType
      },
      body: new Uint8Array(body),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[stt] OpenAI API error response:', response.status, errorText.slice(0, 300))
      return {
        success: false,
        text: '',
        error: `OpenAI Error (${response.status}): ${extractApiError(errorText) || response.statusText}`,
        durationMs: Date.now() - startTime
      }
    }

    const raw = await response.text()
    console.log('[stt] OpenAI response:', raw.slice(0, 500))

    const text = extractTranscript(safeJson(raw)).trim()
    const durationMs =
      recordingDurationMs && recordingDurationMs > 0 ? recordingDurationMs : Date.now() - startTime

    return { success: true, text, durationMs }
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    const message = err instanceof Error ? err.message : String(err)
    console.error('[stt] Failed to transcribe with OpenAI:', message)
    return {
      success: false,
      text: '',
      error: isAbort
        ? 'OpenAI request timed out. Please try again.'
        : message || 'Network error while calling the OpenAI transcription API',
      durationMs: Date.now() - startTime
    }
  } finally {
    clearTimeout(timeout)
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/**
 * OpenAI answers with `{ text }`. Keep tolerating `transcription`/`transcript`/
 * `result`/`output` variants so a proxy or field rename cannot break paste.
 */
function extractTranscript(data: unknown): string {
  if (typeof data === 'string') {
    return data
  }

  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>

    for (const key of ['text', 'transcription', 'transcript', 'result', 'output']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) {
        return value
      }
    }

    const nested = record.data
    if (nested && typeof nested === 'object') {
      const nestedRecord = nested as Record<string, unknown>
      for (const key of ['text', 'transcription', 'transcript', 'result', 'output']) {
        const value = nestedRecord[key]
        if (typeof value === 'string' && value.trim()) {
          return value
        }
      }
    }

    // Last resort: first string value that is not metadata (never JSON.stringify,
    // that used to paste raw JSON into the user's document).
    for (const [key, value] of Object.entries(record)) {
      if (NON_TRANSCRIPT_KEYS.has(key.toLowerCase())) continue
      if (typeof value === 'string' && value.trim()) {
        return value
      }
    }
  }

  return ''
}
/**
 * Builds a multipart/form-data body by hand. Node's global FormData works too,
 * but a Buffer body keeps the byte layout deterministic (and unit-testable)
 * across Electron/Node versions.
 */
export function buildMultipartBody(
  fields: Record<string, string>,
  audio: Buffer,
  filename = 'speech.wav'
): { body: Buffer; contentType: string } {
  const boundary = `----AstronBoundary${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  const parts: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    )
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/wav\r\n\r\n`
    )
  )
  parts.push(audio)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  }
}

/** OpenAI errors look like `{ "error": { "message": "..." } }`. */
export function extractApiError(raw: string): string {
  const parsed = safeJson(raw)
  if (parsed && typeof parsed === 'object') {
    const err = (parsed as Record<string, unknown>).error
    if (typeof err === 'string' && err.trim()) return err.trim()
    if (err && typeof err === 'object') {
      const message = (err as Record<string, unknown>).message
      if (typeof message === 'string' && message.trim()) return message.trim()
    }
    const message = (parsed as Record<string, unknown>).message
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return raw.trim().slice(0, 200)
}

