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
        for (const c of content) if (typeof c.text === 'string') parts.push(c.text)
      }
    }
    if (parts.length > 0) return parts.join('\n')
  }
  return ''
}

async function callAstra(system: string, user: string, maxTokens = 800): Promise<string | null> {
  const key = apiKey()
  if (!key) return null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 45_000)
    try {
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: plannerModel(),
          instructions: system,
          input: user,
          max_output_tokens: maxTokens
        })
      })
      if (!res.ok) {
        console.warn('[planner] Astra HTTP', res.status, (await res.text()).slice(0, 300))
        return null
      }
      const json = (await res.json()) as ResponsesTextOut & Record<string, unknown>
      const text = extractText(json).trim()
      return text || null
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    console.warn('[planner] Astra call failed, using heuristic fallback:', err)
    return null
  }
}

/** Split one user task into N parallel shards. Falls back to heuristics offline. */
export async function planShards(task: string, count: number): Promise<string[]> {
  const n = Math.max(1, Math.min(5, count))
  if (n === 1) return [task]
  const ai = await callAstra(
    'You split computer-use research tasks into parallel shards. Reply with exactly N lines, one shard task per line, no numbering, no extra text.',
    `Split into ${n} non-overlapping shards:\n${task}`
  )
  if (ai) {
    const lines = ai
      .split('\n')
      .map((l) => l.replace(/^\s*\d+[.)\-:]\s*/, '').trim())
      .filter(Boolean)
    if (lines.length >= n) return lines.slice(0, n)
    if (lines.length >= 2) {
      while (lines.length < n) lines.push(`${task} (part ${lines.length + 1}/${n})`)
      return lines.slice(0, n)
    }
  }
  // Heuristic fallback: shard by angle.
  const angles = [
    'Overview + key facts',
    'Docs + official sources',
    'Comparisons + alternatives',
    'Pricing/limits/caveats',
    'Examples + best practices'
  ]
  return Array.from({ length: n }, (_, i) => `${task} — focus: ${angles[i % angles.length]}`)
}

/** Merge parallel findings into one summary. Falls back to concatenation. */
export async function mergeFindings(brief: string, findings: string[]): Promise<string> {
  const nonEmpty = findings.filter((f) => f.trim())
  if (nonEmpty.length === 0) return 'No findings were collected.'
  if (nonEmpty.length === 1) return nonEmpty[0]
  const ai = await callAstra(
    'You merge parallel agent findings into one deduped markdown summary with Sources section. Keep it tight.',
    `Task: ${brief}\n\nFindings:\n${nonEmpty.map((f, i) => `--- worker ${i + 1} ---\n${f}`).join('\n')}`
  )
  if (ai) return ai
  return `# ${brief}\n\n${nonEmpty.map((f, i) => `## Worker ${i + 1}\n${f}`).join('\n\n')}`
}

export function routeMode(task: string): 'normal' | 'detached' {
  const t = task.toLowerCase()
  if (
    /(my (pc|computer|desktop|screen))|(help me while)|(fix .* (vs ?code|chrome|on my))|(open .* on my computer)|(put .* (into|in) this document)|(type .* for me)|(in this (doc|document|window))/.test(
      t
    )
  ) {
    return 'normal'
  }
  return 'detached'
}
