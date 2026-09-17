/**
 * Safety gate for computer-use actions.
 * - Detached browser work is allow-listed and freely runnable.
 * - Normal (local PC) + sensitive patterns always need approval when
 *   `askBeforeSensitive` is on.
 */

const SENSITIVE_PATTERNS: RegExp[] = [
  /password/i,
  /credit\s*card/i,
  /\bcvv\b/i,
  /purchase/i,
  /buy\s+now/i,
  /checkout/i,
  /delete\s+(all|everything)/i,
  /format\s+[a-z]:/i,
  /rm\s+-rf/i,
  /send\s+(money|payment)/i,
  /bank/i
]

const BLOCKED_URL_SUBSTRINGS = ['bank', 'wallet', 'crypto-exchange']

export function isSensitiveAction(text: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(text))
}

export function isBlockedUrl(url: string): boolean {
  const lower = url.toLowerCase()
  return BLOCKED_URL_SUBSTRINGS.some((s) => lower.includes(s))
}

/** Restrict detached workers to http(s) + allow-listed hosts when provided. */
export function isUrlAllowed(url: string, allowList: string[] = []): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (allowList.length === 0) return !isBlockedUrl(url)
  return allowList.some((h) => parsed.hostname === h || parsed.hostname.endsWith('.' + h))
}

