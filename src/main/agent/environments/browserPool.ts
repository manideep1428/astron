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

  }
}
