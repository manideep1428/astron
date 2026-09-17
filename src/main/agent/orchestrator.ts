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
    } catch {
      wins = []
    }
    for (const win of wins) {
      try {
        if (!win.isDestroyed()) win.webContents.send('agent:event', ev)
      } catch {
        // ignore
      }
    }
  }

  private touchAgent(run: AgentRun, agentId: string, patch: Partial<Agent>): Agent | undefined {
    const agent = run.agents.find((a) => a.id === agentId)
    if (!agent) return undefined
    Object.assign(agent, patch, { updatedAt: Date.now() })
    run.updatedAt = Date.now()
    return agent
  }

  private setRunStatus(run: AgentRun, status: RunStatus): void {
    run.status = status
    run.updatedAt = Date.now()
  }

  resolveMode(requested: CreateRunRequest['mode'], task: string): ResolvedAgentMode {
    const r = requested ?? this.settings.mode
    if (r === 'detached') return 'detached'
    if (r === 'my-computer') return 'normal'
    return routeMode(task)
  }

  async createRun(req: CreateRunRequest): Promise<AgentRun> {
    const task = (req.task || '').trim()
    if (!task) throw new Error('Task is empty.')
    const execution: ExecutionMode = req.execution ?? this.settings.execution ?? 'parallel'
    const maxAgents = Math.max(1, Math.min(5, req.count ?? this.settings.maxAgents ?? 3))
    const mode = this.resolveMode(req.mode ?? this.settings.mode, task)
    const count = mode === 'normal' ? 1 : maxAgents
    const shards = mode === 'normal' ? [task] : await planShards(task, count)
    const runId = newId('run')
    const mem = createMemory(runId, task)
    const total = Math.min(shards.length, count)
    const run: AgentRun = {
      id: runId,
      prompt: task,
      requestedMode: req.mode ?? this.settings.mode,
      execution,
      maxAgents: count,
      status: 'running',
      agents: shards.slice(0, count).map((shard, i) => ({
        id: newId('agent'),
        runId,
        role: (req.roles?.[i] ?? (mode === 'normal' ? 'desktop' : roleFor(i, total))) as AgentRole,
        mode,
        environmentId: 'pending',
        task: shard,
        status: 'idle' as const,
        progress: 0,
        currentAction: 'Queued',
        shardIndex: i,
        totalShards: total,
        startedAt: Date.now(),
        updatedAt: Date.now()
      })),
      sharedMemoryId: mem.id,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    this.runs.set(runId, run)
    this.cancelFlags.set(runId, false)
    this.broadcast({ runId, type: 'run-started', text: task, at: Date.now() })
    if (execution === 'sequential') {
      void this.runSequential(runId).catch((err) => this.failRun(runId, String(err)))
    } else {
      for (const agent of run.agents) {
        void this.runAgent(runId, agent.id).catch((err) => this.failAgent(runId, agent.id, String(err)))
      }
      void this.watchParallelCompletion(runId)
    }

  }
}
export const orchestrator = new Orchestrator()
