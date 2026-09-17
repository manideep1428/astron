import { browserPool } from '../environments/browserPool'
import { isUrlAllowed } from '../permissions'

export interface BrowserTaskResult {
  text: string
  finalUrl: string
  screenshot: string
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Used when the user just says "open browser" without naming a site. */
export const DEFAULT_OPEN_URL = 'https://www.google.com'

/** "open example.com" / "go to https://x" → concrete URL, otherwise null. */
export function resolveOpenTarget(task: string): string | null {
  const explicit = task.match(/https?:\/\/[^\s"'<>]+/i)
  if (explicit) return explicit[0]
  if (!/^\s*(open|launch|start|go to|visit|navigate)\b/i.test(task)) return null
  const domain = task.match(/\b([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+)\b/i)
  return domain ? `https://${domain[1]}` : null
}

/** Navigation-only tasks ("open browser", "open example.com") skip the search step. */
export function isOpenOnlyTask(task: string): boolean {
  const lower = task.trim().toLowerCase()
  return (
    /^(open|launch|start|go to|visit|navigate)\b/.test(lower) &&
    !/\b(search|research|compare|find|report|summari[sz]e|summary|analy[sz]e)\b/.test(lower)
  )
}

/**
 * Shared deterministic worker: search → open top results → extract text.
 * Keeps model calls out of the per-click loop for speed; Astra only
 * planned the shard and later merges the text.
 */
export async function runBrowserTask(
  envId: string,
  shard: string,
  onStep: (msg: string, progress: number) => void
): Promise<BrowserTaskResult> {
  const page = browserPool.getPage(envId)
  if (!page) throw new Error(`No pooled page for ${envId}`)

  // Simple navigation tasks ("open browser") must not become a web search.
  const openTarget = resolveOpenTarget(shard)
  if (openTarget || isOpenOnlyTask(shard)) {
    const url = openTarget ?? DEFAULT_OPEN_URL
    if (!isUrlAllowed(url)) throw new Error(`Blocked URL: ${url}`)
    onStep(`Opening ${url}`, 15)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    onStep('Reading page', 60)
