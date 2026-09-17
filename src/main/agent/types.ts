export type AgentModeSetting = 'ask' | 'my-computer' | 'detached' | 'auto'
export type ResolvedAgentMode = 'normal' | 'detached'
export type AgentRole = 'research' | 'browser' | 'coding' | 'verifier' | 'desktop'
export type AgentStatus =
  | 'idle'
  | 'working'
  | 'waiting-approval'
  | 'paused'
  | 'completed'
  | 'failed'
export type RunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
export type ExecutionMode = 'sequential' | 'parallel'

export interface Agent {
  id: string
  runId: string
  role: AgentRole
  /** Resolved execution placement. `auto` is resolved by the orchestrator before spawn. */
  mode: ResolvedAgentMode
  environmentId: string
  task: string
  status: AgentStatus
  progress: number
  currentAction?: string
  shardIndex?: number
  totalShards?: number
  error?: string
  startedAt: number
  updatedAt: number
}

export interface AgentRun {
  id: string
  prompt: string
  requestedMode: AgentModeSetting
  execution: ExecutionMode
  maxAgents: number
  status: RunStatus
  agents: Agent[]
  sharedMemoryId: string
  createdAt: number
  updatedAt: number
}

export interface ComputerUseSettings {
  mode: AgentModeSetting
  maxAgents: number
  execution: ExecutionMode
  askBeforeSensitive: boolean
  showActivity: boolean
  allowAgentComms: boolean
}

export const DEFAULT_COMPUTER_USE: ComputerUseSettings = {
  mode: 'auto',
  maxAgents: 3,
  execution: 'parallel',
  askBeforeSensitive: true,
  showActivity: true,
  allowAgentComms: true
}

export type AgentEventType =
  | 'run-started'
  | 'run-updated'
