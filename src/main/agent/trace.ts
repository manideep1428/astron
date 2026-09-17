import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from 'fs'
import type { AgentEvent } from './types'

function runsDir(): string {
  const dir = join(app.getPath('userData'), 'runs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function runDir(runId: string): string {
  const dir = join(runsDir(), runId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Append-only JSONL trace: one line per agent event. Powers Replay. */
export function appendTraceEvent(runId: string, event: AgentEvent): void {
  try {
    const file = join(runDir(runId), 'events.jsonl')
    // Screenshots are stored separately to keep the trace readable.
    const { screenshot, ...rest } = event
    void screenshot
    appendFileSync(file, JSON.stringify(rest) + '\n', 'utf-8')
  } catch (err) {
    console.warn('[trace] append failed:', err)
  }
}

export function saveScreenshot(runId: string, agentId: string, base64: string): void {
  try {
    if (!base64) return
    const file = join(runDir(runId), `${agentId}-${Date.now()}.png.b64.txt`)
    writeFileSync(file, base64.slice(0, 500_000), 'utf-8')
  } catch (err) {
    console.warn('[trace] screenshot save failed:', err)
  }
}

export function saveSummary(runId: string, summary: string): void {
  try {
    writeFileSync(join(runDir(runId), 'summary.md'), summary, 'utf-8')
  } catch (err) {
    console.warn('[trace] summary save failed:', err)
  }
}

export function readTrace(runId: string): AgentEvent[] {
  try {
    const file = join(runDir(runId), 'events.jsonl')
    if (!existsSync(file)) return []
    const raw = readFileSync(file, 'utf-8')
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AgentEvent)
  } catch {
    return []
  }
}
