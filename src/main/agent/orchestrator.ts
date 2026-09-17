import { BrowserWindow } from 'electron'
import { browserPool } from './environments/browserPool'
import { runLocalStub } from './environments/desktopLocal'
import { runBrowserTask } from './agents/browserWorker'
import { mergeFindings, planShards, routeMode } from './planner'
import { appendFinding, createMemory, getMemory, setMergedSummary } from './memory'
import { needsApproval } from './permissions'
import { appendTraceEvent, saveScreenshot, saveSummary } from './trace'
import type {
  Agent,
  AgentEvent,
  AgentRole,
  AgentRun,
  ComputerUseSettings,
  CreateRunRequest,
  ExecutionMode,
  ResolvedAgentMode,
  RunStatus
} from './types'
import { DEFAULT_COMPUTER_USE, newId } from './types'

function roleFor(index: number, total: number): AgentRole {
  if (total === 1) return 'browser'
  if (index === total - 1) return 'verifier'
  return index % 2 === 0 ? 'research' : 'browser'
}

class Orchestrator {
  private runs = new Map<string, AgentRun>()
  private cancelFlags = new Map<string, boolean>()
  private pausedRuns = new Set<string>()
  private settings: ComputerUseSettings = { ...DEFAULT_COMPUTER_USE }
  private emit: ((ev: AgentEvent) => void) | null = null

  setEmitter(fn: (ev: AgentEvent) => void): void {
    this.emit = fn
  }

  updateSettings(patch: Partial<ComputerUseSettings>): ComputerUseSettings {
    this.settings = {
      ...this.settings,
      ...patch,
      maxAgents: Math.max(1, Math.min(5, patch.maxAgents ?? this.settings.maxAgents ?? 3))
    }
    return { ...this.settings }
  }

  getSettings(): ComputerUseSettings {
    return { ...this.settings }
  }

  listRuns(): AgentRun[] {
    return [...this.runs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)
  }

  getRun(runId: string): AgentRun | undefined {
    return this.runs.get(runId)
  }

  private push(ev: AgentEvent): void {
    appendTraceEvent(ev.runId, ev)
    if (ev.screenshot) saveScreenshot(ev.runId, ev.agentId ?? 'run', ev.screenshot)
    try {
      this.emit?.(ev)
    } catch {
      // renderer may be closed
    }
    try {
      const { socketHub } = require('../hub') as typeof import('../hub')
      socketHub.broadcastAgentEvent(ev)
    } catch {
      // hub not started yet during early boot
    }
  }

  private broadcast(ev: AgentEvent): void {
    this.push(ev)
    let wins: BrowserWindow[] = []
    try {
      wins = BrowserWindow.getAllWindows()

  }
}
export const orchestrator = new Orchestrator()
