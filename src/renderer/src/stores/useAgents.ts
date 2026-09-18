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

}));
