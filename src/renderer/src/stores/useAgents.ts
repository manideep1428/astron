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

export const useAgents = create<AgentState>((set, get) => ({
  runs: [],
  activeRunId: null,
  lastEvent: null,
  screenshots: {},
  summaries: {},
  setRuns: (runs) => set({ runs }),
  setActiveRun: (id) => set({ activeRunId: id }),
  applyEvent: (ev) =>
    set((s) => ({
      lastEvent: ev,
      runs: mergeRun(s.runs, ev),
      screenshots:
        ev.screenshot && ev.agentId ? { ...s.screenshots, [ev.agentId]: ev.screenshot } : s.screenshots,
      summaries:
        (ev.type === 'run-finished' || ev.type === 'agent-finished') && ev.text
          ? { ...s.summaries, [ev.agentId ?? ev.runId]: ev.text }
          : s.summaries
    })),
  refresh: async () => {
    try {
      const { hubSocket } = await import('../utils/hubSocket')
      try {
        const runs = await hubSocket.rpc<AgentRunItem[]>('agent:list')
        set({ runs })
        const { activeRunId } = get()
        if (!activeRunId && runs.length > 0) set({ activeRunId: runs[0].id })
        return
      } catch {
        // fall through to IPC when socket not open yet
      }
      if (!window.astronApi?.listAgentRuns) return
      const runs = await window.astronApi.listAgentRuns()
      set({ runs })
      const { activeRunId } = get()
      if (!activeRunId && runs.length > 0) set({ activeRunId: runs[0].id })
    } catch {
      // dashboard stays usable offline
    }
  }
}))
