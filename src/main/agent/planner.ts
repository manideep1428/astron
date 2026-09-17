import { configManager } from '../config'

/**
 * GPT-4.1 mini plans shards and merges findings. Astra is the PLANNER only:
 * it splits tasks and merges findings; workers execute deterministic Playwright
 * code locally for speed.
 */

export function plannerModel(): string {
  return (process.env.OPENAI_MODEL || process.env.GPT_MODEL || 'gpt-4.1-mini').trim()
}

/** Saved Settings key wins; environment is the fallback for dev/headless runs. */
function apiKey(): string {
  return (
    configManager.get().openaiApiKey?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.GPT_API_KEY?.trim() ||
    ''
  )
}

interface ResponsesTextOut {
  output_text?: string
  output?: Array<{ content?: Array<{ text?: string; type?: string }> }>
}

function extractText(json: ResponsesTextOut & Record<string, unknown>): string {
  if (typeof json.output_text === 'string' && json.output_text.trim()) return json.output_text
  const out = json.output
  if (Array.isArray(out)) {
    const parts: string[] = []
    for (const item of out) {
      const content = (item as { content?: Array<{ text?: string }> }).content
      if (Array.isArray(content)) {
