import type { AgentRunItem } from '../stores/useAgents'

export interface AgentDot {
  id: string
  status: string
  color: string
  bounce: boolean
}

/** One small circle per agent: yellow = working, green = done, red = failed. */
const DOT_COLORS: Record<string, string> = {
  working: '#fbbf24',
  idle: '#fbbf24',
  'waiting-approval': '#fbbf24',
  paused: '#fbbf24',
  completed: '#34d399',
  failed: '#f87171',
  cancelled: '#64748b'
}

export function deriveAgentDots(runs: AgentRunItem[]): AgentDot[] {
  const active = runs.filter((r) => r.status === 'running' || r.status === 'paused')
  const shown = active
  return shown.flatMap((run) =>
    run.agents.map((agent) => {
      const status = run.status === 'paused' && ['working', 'idle'].includes(agent.status)
        ? 'paused' : agent.status
      return { id: agent.id, status, color: DOT_COLORS[status] ?? '#94a3b8', bounce: status === 'working' }
    })
  )
}

export function describeAgentDots(dots: AgentDot[]): string {
  if (!dots.length) return 'no agents'
  const tally = new Map<string, number>()
  for (const dot of dots) tally.set(dot.status, (tally.get(dot.status) ?? 0) + 1)
  return [...tally].map(([status, n]) => `${n} ${status}`).join(', ')
}
