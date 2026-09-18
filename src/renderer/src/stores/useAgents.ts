import { create } from 'zustand'

export type AgentStatus =
  | 'idle'
  | 'working'
  | 'waiting-approval'
  | 'paused'
  | 'completed'
  | 'failed'

export interface AgentItem {
  id: string
  runId: string
  role: string
  mode: 'normal' | 'detached'
  environmentId: string
  task: string
  status: AgentStatus
  progress: number
  currentAction?: string
  error?: string
}

export interface AgentRunItem {
  id: string
  prompt: string
  requestedMode: string
  execution: 'sequential' | 'parallel'
  maxAgents: number
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  agents: AgentItem[]
  sharedMemoryId: string
  createdAt: number
  updatedAt: number
}

export interface AgentEventItem {
  runId: string
  agentId?: string
  type: string
  status?: string
  progress?: number
  currentAction?: string
  text?: string
  screenshot?: string
  error?: string
  at: number
}

interface AgentState {
  runs: AgentRunItem[]
  activeRunId: string | null
  lastEvent: AgentEventItem | null
  screenshots: Record<string, string>
  summaries: Record<string, string>
  setRuns: (runs: AgentRunItem[]) => void
  setActiveRun: (id: string | null) => void
  applyEvent: (ev: AgentEventItem) => void
  refresh: () => Promise<void>
}

function mergeRun(runs: AgentRunItem[], ev: AgentEventItem): AgentRunItem[] {
  return runs.map((run) => {
    if (run.id !== ev.runId) return run
    if (ev.type === 'run-started' || ev.type === 'run-updated' || ev.type === 'run-finished') {
      return { ...run, status: (ev.status as AgentRunItem['status']) ?? run.status, updatedAt: ev.at }
    }
    if (!ev.agentId) return run
    return {
      ...run,
      updatedAt: ev.at,
      agents: run.agents.map((a) =>
        a.id === ev.agentId
          ? {
              ...a,
              status: (ev.status as AgentStatus) ?? a.status,
              progress: ev.progress ?? a.progress,
              currentAction: ev.currentAction ?? a.currentAction,
              error: ev.error ?? a.error
            }
          : a
      )
    }
  })
}

}));
