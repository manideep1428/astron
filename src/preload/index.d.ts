import { ElectronAPI } from '@electron-toolkit/preload'

export interface HistoryItem {
  id: string
  timestamp: number
  text: string
  durationMs: number
}

export interface ComputerUseConfig {
  mode: 'ask' | 'my-computer' | 'detached' | 'auto'
  maxAgents: number
  execution: 'sequential' | 'parallel'
  askBeforeSensitive: boolean
  showActivity: boolean
  allowAgentComms: boolean
}

export interface AppConfig {
  openaiApiKey: string
  apiUrl: string
  language: string
  history: HistoryItem[]
  computerUse: ComputerUseConfig
}

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
  requestedMode: 'ask' | 'my-computer' | 'detached' | 'auto'
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

export interface AstronAPI {
  platform: NodeJS.Platform
  getAssistantState: () => Promise<{ held: boolean; session: number }>
  dismissAssistant: () => Promise<void>
  submitAssistant: (request: { session: number; audio: ArrayBuffer; durationMs: number }) => Promise<{ text: string; runId: string }>
  onAssistantHold: (callback: (state: { held: boolean; session: number }) => void) => () => void
  getConfig: () => Promise<AppConfig>
  saveConfig: (newConfig: Partial<AppConfig>) => Promise<AppConfig>
  showDashboard: () => Promise<void>
  createAgentRun: (req: {
    task: string
    mode?: 'ask' | 'my-computer' | 'detached' | 'auto'
    count?: number
    execution?: 'sequential' | 'parallel'
  }) => Promise<AgentRunItem>
  listAgentRuns: () => Promise<AgentRunItem[]>
  pauseAgentRun: (runId: string) => Promise<void>
  resumeAgentRun: (runId: string) => Promise<void>
  cancelAgentRun: (runId: string) => Promise<void>
  approveAgent: (runId: string, agentId: string) => Promise<void>
  getAgentSettings: () => Promise<ComputerUseConfig>
  saveAgentSettings: (patch: Partial<ComputerUseConfig>) => Promise<ComputerUseConfig>
  onAgentEvent: (callback: (ev: AgentEventItem) => void) => () => void
  setHubAgentCount: (count: number) => Promise<void>
  setHubExpanded: (expanded: boolean) => Promise<void>
  getHubInfo: () => Promise<{ port: number; token: string }>
  onVoiceWsState: (callback: (state: string) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    astronApi: AstronAPI
  }
}
