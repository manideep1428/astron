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
