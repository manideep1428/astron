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
