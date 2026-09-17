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
