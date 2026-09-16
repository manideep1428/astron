import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

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

export type AgentModeSetting = 'ask' | 'my-computer' | 'detached' | 'auto'
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
  requestedMode: AgentModeSetting
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

const astronApi = {
  platform: process.platform,
  getAssistantState: (): Promise<{ held: boolean; session: number }> => ipcRenderer.invoke('assistant:state'),
  dismissAssistant: (): Promise<void> => ipcRenderer.invoke('assistant:dismiss'),
  submitAssistant: (request: { session: number; audio: ArrayBuffer; durationMs: number }): Promise<{ text: string; runId: string }> => ipcRenderer.invoke('assistant:submit', request),
  onAssistantHold: (callback: (state: { held: boolean; session: number }) => void): (() => void) => {
    const handler = (_: unknown, state: { held: boolean; session: number }): void => callback(state)
    ipcRenderer.on('assistant:hold', handler)
    return () => { ipcRenderer.removeListener('assistant:hold', handler) }
  },
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('get-config'),
  saveConfig: (newConfig: Partial<AppConfig>): Promise<AppConfig> =>
    ipcRenderer.invoke('save-config', newConfig),
  showDashboard: (): Promise<void> => ipcRenderer.invoke('show-dashboard'),
  createAgentRun: (req: {
    task: string
    mode?: AgentModeSetting
    count?: number
    execution?: 'sequential' | 'parallel'
  }): Promise<AgentRunItem> => ipcRenderer.invoke('agent:create', req),
  listAgentRuns: (): Promise<AgentRunItem[]> => ipcRenderer.invoke('agent:list'),
  pauseAgentRun: (runId: string): Promise<void> => ipcRenderer.invoke('agent:pause', runId),
  resumeAgentRun: (runId: string): Promise<void> => ipcRenderer.invoke('agent:resume', runId),
  cancelAgentRun: (runId: string): Promise<void> => ipcRenderer.invoke('agent:cancel', runId),
  approveAgent: (runId: string, agentId: string): Promise<void> =>
    ipcRenderer.invoke('agent:approve', runId, agentId),
  getAgentSettings: (): Promise<ComputerUseConfig> => ipcRenderer.invoke('agent:get-settings'),
  saveAgentSettings: (patch: Partial<ComputerUseConfig>): Promise<ComputerUseConfig> =>
    ipcRenderer.invoke('agent:save-settings', patch),

  onAgentEvent: (callback: (ev: AgentEventItem) => void): (() => void) => {
    const handler = (_: unknown, ev: AgentEventItem): void => callback(ev)
    ipcRenderer.on('agent:event', handler)
    return (): void => {
      ipcRenderer.removeListener('agent:event', handler)
    }
  },

  setHubAgentCount: (count: number): Promise<void> => ipcRenderer.invoke('hub:set-agent-count', count),
  setHubExpanded: (expanded: boolean): Promise<void> => ipcRenderer.invoke('hub:set-expanded', expanded),
  getHubInfo: (): Promise<{ port: number; token: string }> => ipcRenderer.invoke('hub:info'),

  onVoiceWsState: (callback: (state: string) => void): (() => void) => {
    const handler = (_: unknown, state: string): void => callback(state)
    ipcRenderer.on('voice:ws-state', handler)
    return (): void => {
      ipcRenderer.removeListener('voice:ws-state', handler)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('astronApi', astronApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.astronApi = astronApi
}
