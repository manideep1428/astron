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
    const title = await page.title().catch(() => '')
    const visible = await page
      .evaluate(`(() => {
        const el = document.querySelector('main, article, [role="main"]') || document.body;
        return (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 1200);
      })()`)
      .catch(() => '')
    const finalUrl = page.url()
    onStep('Capturing evidence', 90)
    const shot = await page.screenshot({ type: 'png' }).then((b) => b.toString('base64'))
    return {
      text: `# Opened browser\n\n- URL: ${finalUrl}\n- Title: ${title || '(no title)'}\n\n${visible}`,
      finalUrl,
      screenshot: shot
    }
  }

  onStep('Opening search', 10)
  const query = encodeURIComponent(shard.slice(0, 200))
  const startUrl = `https://duckduckgo.com/?q=${query}`
  if (!isUrlAllowed(startUrl)) throw new Error('Search URL blocked')
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  onStep('Reading results', 35)

  const results = await page
    .evaluate(`(() => {
      const anchors = Array.from(document.querySelectorAll('a.result__a, a[data-testid="result-title-a"], h2 a'));
      return anchors.slice(0, 5).map(a => ({ title: (a.textContent||'').trim().slice(0,140), href: a.href })).filter(r => r.href && r.href.startsWith('http'));
    })()`)
    .catch(() => [] as Array<{ title: string; href: string }>)

  const visited: string[] = []
  const chunks: string[] = []
  const targets = (results as Array<{ title: string; href: string }>).slice(0, 3)
  let i = 0
  for (const r of targets) {
    i += 1
    if (!isUrlAllowed(r.href)) continue
    try {
      onStep(`Reading ${i}/${targets.length}: ${r.title.slice(0, 40)}`, 40 + i * 15)
      await page.goto(r.href, { waitUntil: 'domcontentloaded', timeout: 25_000 })
      await page.waitForTimeout(800)
      const text = await page
        .evaluate(`(() => {
          const el = document.querySelector('main, article, [role="main"]') || document.body;
          return (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 2500);
        })()`)
        .catch(() => '')
      visited.push(`${r.title} — ${r.href}`)
      if (text) chunks.push(`SOURCE: ${r.title}\nURL: ${r.href}\n${text}`)
    } catch (err) {
      chunks.push(`SOURCE FAILED: ${r.title} (${r.href}): ${String(err).slice(0, 200)}`)
    }
  }

  if (chunks.length === 0) {
    const bodyText = await page
      .evaluate(`(() => (document.body?.innerText || '').replace(/\\s+/g,' ').trim().slice(0,2000))`)
      .catch(() => '')
    chunks.push(`SEARCH PAGE SNAPSHOT for "${esc(shard).slice(0, 120)}":\n${bodyText}`)
  }

  onStep('Capturing evidence', 90)
  const shot = await page.screenshot({ type: 'png' }).then((b) => b.toString('base64'))
  const text = `# Findings: ${shard}\n\nVisited:\n${visited.map((v) => `- ${v}`).join('\n') || '- (search page only)'}\n\n${chunks.join('\n\n---\n\n')}`
  return { text, finalUrl: page.url(), screenshot: shot }
}
