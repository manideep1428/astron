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
