/**
 * Shared memory for cooperating agents in one run.
 * Keeps findings small (JSON/text) — never full screenshots — so the
 * planner prompt stays fast and cheap.
 */
export interface SharedMemory {
  id: string
  runId: string
  brief: string
  findings: Array<{ agentId: string; role: string; text: string; at: number }>
  mergedSummary?: string
  createdAt: number
  updatedAt: number
}

const store = new Map<string, SharedMemory>()

function memId(): string {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`
}

export function createMemory(runId: string, brief: string): SharedMemory {
  const mem: SharedMemory = {
    id: memId(),
    runId,
    brief,
    findings: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  store.set(mem.id, mem)
  return mem
}

export function getMemory(id: string): SharedMemory | undefined {
  return store.get(id)
}

export function appendFinding(
  memoryId: string,
  agentId: string,
  role: string,
  text: string
): SharedMemory | undefined {
  const mem = store.get(memoryId)
  if (!mem) return undefined
  // Cap each finding so one verbose worker cannot blow up the planner context.
  const clipped = text.length > 4000 ? text.slice(0, 4000) + '\n…[truncated]' : text
  mem.findings.push({ agentId, role, text: clipped, at: Date.now() })
  mem.updatedAt = Date.now()
  return mem
}

export function setMergedSummary(memoryId: string, summary: string): void {
  const mem = store.get(memoryId)
  if (!mem) return
  mem.mergedSummary = summary
  mem.updatedAt = Date.now()
}

export function deleteMemory(memoryId: string): void {
  store.delete(memoryId)
}

export function buildMemoryContext(mem: SharedMemory): string {
  if (mem.findings.length === 0) return `Task brief: ${mem.brief}\nNo findings yet.`
  const lines = mem.findings.map(
    (f, i) => `[${i + 1}] (${f.role}/${f.agentId}): ${f.text}`
  )
  return `Task brief: ${mem.brief}\nFindings so far:\n${lines.join('\n')}`
}
