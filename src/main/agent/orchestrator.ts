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
    return this.clone(run)
  }

  private async runSequential(runId: string): Promise<void> {
    const run = this.runs.get(runId)
    if (!run) return
    for (const agent of run.agents) {
      if (this.cancelFlags.get(runId)) break
      await this.waitIfPaused(runId)
      if (this.cancelFlags.get(runId)) break
      await this.runAgent(runId, agent.id)
    }
    await this.finishRun(runId)
  }

  private async watchParallelCompletion(runId: string): Promise<void> {
    for (;;) {
      await new Promise((r) => setTimeout(r, 500))
      const run = this.runs.get(runId)
      if (!run) return
      if (run.status !== 'running' && run.status !== 'paused') return
      const done = run.agents.every((a) => a.status === 'completed' || a.status === 'failed')
      if (done) {
        await this.finishRun(runId)
        return
      }
    }
  }

  private async waitIfPaused(runId: string): Promise<void> {
    while (this.pausedRuns.has(runId) && !this.cancelFlags.get(runId)) {
      await new Promise((r) => setTimeout(r, 250))
    }
  }

  private async runAgent(runId: string, agentId: string): Promise<void> {
    const run = this.runs.get(runId)
    if (!run) return
    const agent = run.agents.find((a) => a.id === agentId)
    if (!agent || agent.status === 'completed' || agent.status === 'failed') return
    if (this.cancelFlags.get(runId)) {
      this.touchAgent(run, agentId, { status: 'failed', error: 'Cancelled' })
      return
    }
    await this.waitIfPaused(runId)
    this.touchAgent(run, agentId, { status: 'working', progress: 2, currentAction: 'Starting' })
    this.broadcast({ runId, agentId, type: 'agent-started', status: 'working', text: agent.task, at: Date.now() })
    const step = (msg: string, progress: number): void => {
      this.touchAgent(run, agentId, { currentAction: msg, progress })
      this.broadcast({ runId, agentId, type: 'agent-progress', status: 'working', progress, currentAction: msg, at: Date.now() })
    }
    try {
      if (agent.mode === 'normal') {
        const decision = needsApproval(agent.task, {
          mode: 'normal',
          askBeforeSensitive: this.settings.askBeforeSensitive
        })
        if (decision.needsApproval) {
          this.touchAgent(run, agentId, { status: 'waiting-approval', currentAction: 'Waiting for approval' })
          this.broadcast({ runId, agentId, type: 'agent-waiting-approval', status: 'waiting-approval', currentAction: 'Waiting for approval', text: decision.reason, at: Date.now() })
          const stub = await runLocalStub(agent.task)
          appendFinding(run.sharedMemoryId, agent.id, agent.role, stub)
          this.touchAgent(run, agentId, { status: 'completed', progress: 100, currentAction: 'Held for approval' })
          this.broadcast({ runId, agentId, type: 'agent-finished', status: 'completed', progress: 100, text: stub, at: Date.now() })
          return
        }
      }
      step('Acquiring computer', 5)
      const env = await browserPool.acquire(agent.task)
      this.touchAgent(run, agentId, { environmentId: env.id })
      try {
        const result = await runBrowserTask(env.id, agent.task, step)
        appendFinding(run.sharedMemoryId, agent.id, agent.role, result.text)
        this.touchAgent(run, agentId, { progress: 96, currentAction: 'Done - evidence captured' })
        this.broadcast({ runId, agentId, type: 'agent-screenshot', status: 'working', progress: 96, currentAction: 'Evidence captured', screenshot: result.screenshot.slice(0, 400_000), at: Date.now() })
        this.touchAgent(run, agentId, { status: 'completed', progress: 100, currentAction: 'Completed' })
        this.broadcast({ runId, agentId, type: 'agent-finished', status: 'completed', progress: 100, text: result.text.slice(0, 2000), at: Date.now() })
      } finally {
        browserPool.release(env.id)
      }
    } catch (err) {
      this.failAgent(runId, agentId, err instanceof Error ? err.message : String(err))
    }
  }

  private failAgent(runId: string, agentId: string, error: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    this.touchAgent(run, agentId, { status: 'failed', error: error.slice(0, 500), currentAction: 'Failed' })
    this.broadcast({ runId, agentId, type: 'agent-finished', status: 'failed', error, at: Date.now() })
  }

  private failRun(runId: string, error: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    this.setRunStatus(run, 'failed')
    this.broadcast({ runId, type: 'run-finished', status: 'failed', error, at: Date.now() })
  }

  private async finishRun(runId: string): Promise<void> {
    const run = this.runs.get(runId)
    if (!run || run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') return
    if (this.cancelFlags.get(runId)) {
      this.setRunStatus(run, 'cancelled')
      this.broadcast({ runId, type: 'run-finished', status: 'cancelled', at: Date.now() })
      return
    }
    const mem = getMemory(run.sharedMemoryId)
    const texts = (mem?.findings ?? []).map((f) => f.text)
    const summary = await mergeFindings(run.prompt, texts)
    if (mem) setMergedSummary(mem.id, summary)
    saveSummary(runId, summary)
    this.setRunStatus(run, 'completed')
    this.broadcast({ runId, type: 'run-finished', status: 'completed', text: summary.slice(0, 4000), at: Date.now() })
  }

  pauseRun(runId: string): void {
    this.pausedRuns.add(runId)
    const run = this.runs.get(runId)
    if (run && run.status === 'running') {
      this.setRunStatus(run, 'paused')
      this.broadcast({ runId, type: 'run-updated', status: 'paused', at: Date.now() })
    }
  }

  resumeRun(runId: string): void {
    this.pausedRuns.delete(runId)
    const run = this.runs.get(runId)
    if (run && run.status === 'paused') {
      this.setRunStatus(run, 'running')
      this.broadcast({ runId, type: 'run-updated', status: 'running', at: Date.now() })
    }
  }

  cancelRun(runId: string): void {
    this.cancelFlags.set(runId, true)
    this.pausedRuns.delete(runId)
    const run = this.runs.get(runId)
    if (!run) return
    for (const a of run.agents) {
      if (a.status === 'working' || a.status === 'idle' || a.status === 'waiting-approval') {
        a.status = 'failed'
        a.error = 'Cancelled by user'
        a.updatedAt = Date.now()
      }
    }
    this.setRunStatus(run, 'cancelled')
    this.broadcast({ runId, type: 'run-finished', status: 'cancelled', at: Date.now() })
  }

  approveAgent(runId: string, agentId: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    const agent = run.agents.find((a) => a.id === agentId)
    if (!agent || agent.status !== 'waiting-approval') return
    this.touchAgent(run, agentId, { status: 'completed', progress: 100, currentAction: 'Approved (v1 stub)' })
    this.broadcast({ runId, agentId, type: 'agent-finished', status: 'completed', progress: 100, text: 'Approved by user.', at: Date.now() })
    const done = run.agents.every((a) => a.status === 'completed' || a.status === 'failed')
    if (done) void this.finishRun(runId)
  }

  private clone(run: AgentRun): AgentRun {
    return JSON.parse(JSON.stringify(run)) as AgentRun
  }
}

export const orchestrator = new Orchestrator()

