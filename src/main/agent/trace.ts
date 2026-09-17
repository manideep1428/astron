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

