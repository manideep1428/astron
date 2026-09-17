import type { Browser, BrowserContext, Page } from 'playwright'
import { isBlockedUrl } from '../permissions'

export interface PooledEnv {
  id: string
  context: BrowserContext
  page: Page
  lastUsed: number
  busy: boolean
}

const MAX_IDLE_MS = 5 * 60 * 1000
const MAX_ENVS = 5

/** Set AGENT_BROWSER_HEADFUL=1 to watch agents drive a visible Chromium window. */
function isHeadful(): boolean {
  return /^(1|true|yes)$/i.test((process.env.AGENT_BROWSER_HEADFUL || '').trim())
}

/** Lazy playwright import so `npm run dev` still boots when browsers aren't installed. */
async function loadChromium(): Promise<typeof import('playwright')> {
  return await import('playwright')
}

class BrowserPool {
  private browser: Browser | null = null
  private envs = new Map<string, PooledEnv>()
  private counter = 0
  private launching: Promise<Browser> | null = null

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser) return this.browser
    if (this.launching) return this.launching
    this.launching = (async (): Promise<Browser> => {
      const { chromium } = await loadChromium()
      const browser = await chromium.launch({
        headless: !isHeadful(),
        args: ['--disable-blink-features=AutomationControlled']
      })
      this.browser = browser
      return browser
    })()
    try {
      return await this.launching
    } finally {
      this.launching = null
    }
  }

  /** Launch-once, reuse forever. Callers must call `release()` not close. */
  async acquire(taskLabel: string): Promise<PooledEnv> {
    void taskLabel
    this.sweepIdle()
    for (const env of this.envs.values()) {
      if (!env.busy) {
        env.busy = true
        env.lastUsed = Date.now()
        return env
      }
    }
    if (this.envs.size >= MAX_ENVS) {
      throw new Error(`Browser pool exhausted (${MAX_ENVS} environments busy). Try again shortly.`)
    }
    const browser = await this.ensureBrowser()
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 AstronAgent/1.0',
      locale: 'en-US'
    })
    const page = await context.newPage()
    this.counter += 1
    const env: PooledEnv = {
      id: `computer_${this.counter}`,
      context,
      page,
      lastUsed: Date.now(),
      busy: true
    }
    this.envs.set(env.id, env)
    return env
  }

  release(envId: string): void {
    const env = this.envs.get(envId)

  }
}
