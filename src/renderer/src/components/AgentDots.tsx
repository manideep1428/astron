import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAgents } from '../stores/useAgents'
import { deriveAgentDots } from '../utils/agentDots'
import { hubSocket } from '../utils/hubSocket'

export function AgentDots(): JSX.Element {
  const { runs, summaries, refresh, applyEvent } = useAgents()
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hovered = useRef(false)
  const reduced = useReducedMotion()

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const update = (ev: Parameters<typeof applyEvent>[0]): void => {
      applyEvent(ev)
      // Lifecycle events contain no run definitions, so fetch those once.
      if (!useAgents.getState().runs.some((r) => r.id === ev.runId) || ev.type.startsWith('run-')) {
        if (refreshTimer) clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => void refresh(), 60)
      }
    }
    const offWs = hubSocket.onEvent(update)
    const offIpc = window.astronApi.onAgentEvent(update)
    const offHello = hubSocket.onHello(() => void refresh())
    void refresh()
    return () => {
      offWs(); offIpc(); offHello()
      hovered.current = false
      if (refreshTimer) clearTimeout(refreshTimer)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [applyEvent, refresh])

  const open = (): void => {
    hovered.current = true
    if (timer.current) clearTimeout(timer.current)
    void window.astronApi.setHubExpanded(true).then(() => {
      if (hovered.current) setExpanded(true)
    }).catch((e) => setError(String(e)))
  }
  const close = (): void => {
    hovered.current = false
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setExpanded(false)
      void window.astronApi.setHubExpanded(false).catch((e) => setError(String(e)))
    }, 250)
  }
  const active = runs.filter((r) => r.status === 'running' || r.status === 'paused')
  const visible = active.length ? active : runs.slice(0, 1)
  const dots = useMemo(() => deriveAgentDots(runs), [runs])
  const count = dots.filter((d) => !['completed', 'failed'].includes(d.status)).length

  useEffect(() => {
    void window.astronApi.setHubAgentCount(dots.length).then(() => {
      if (!dots.length) setExpanded(false)
    }).catch((e) => setError(String(e)))
    if (!dots.length) {
      hovered.current = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [dots.length])

  return (
    <div className="agent-dots" onMouseEnter={open} onMouseLeave={close}>
      <div className="agent-orbs">
        {dots.map((dot) => (
          <button key={dot.id} className="agent-orb" onClick={open}
            title={`Agent ${dot.id}: ${dot.status}`}
            aria-label={`Agent ${dot.id}: ${dot.status}. Open agent hub`}
            aria-expanded={expanded}>
            <span aria-hidden="true"
              className={`agent-status-dot${dot.bounce && !reduced ? ' agent-status-dot-working' : ''}`}
              data-status={dot.status} style={{ backgroundColor: dot.color }} />
          </button>
        ))}
      </div>
      {expanded && dots.length > 0 && (
        <motion.section className="agent-popover" aria-label="AI Computer activity"
          initial={{ opacity: 0, y: reduced ? 0 : -8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0 : 0.16 }}>
          <header className="agent-header">
            <div><strong>AI Computer</strong><small>{count ? `${count} agents active` : 'Ready when you are'}</small></div>
            <button onClick={() => void window.astronApi.showDashboard().catch((e) => setError(String(e)))}>Dashboard ↗</button>
          </header>
          {error && <p role="alert" className="agent-error">{error}</p>}
          <div className="agent-scroll">
            {!visible.length && <p className="agent-empty">Start a task in Dashboard → AI Computer. Live progress and findings will appear here.</p>}
            {visible.map((run) => (
              <div key={run.id} className="agent-run">
                <p className="agent-prompt">{run.prompt}</p>
                <small>{run.status}</small>
                {run.agents.map((agent) => (
                  <article className="agent-mini-card" key={agent.id}>
                    <div className="agent-header"><strong>{agent.role}</strong><small>{run.status === 'cancelled' ? 'cancelled' : agent.status}</small></div>
                    <p>{agent.currentAction || agent.task}</p>
                    <progress max={100} value={Math.max(0, Math.min(100, agent.progress))} aria-label={`${agent.role} progress`} />
                    {agent.error && <p className="agent-error">{agent.error}</p>}
                    {summaries[agent.id] && <div className="agent-output"><small>Agent findings</small><Output text={summaries[agent.id]} /></div>}
                  </article>
                ))}
                {summaries[run.id] && <div className="agent-output"><small>Combined summary</small><Output text={summaries[run.id]} /></div>}
              </div>
            ))}
          </div>
        </motion.section>
      )}
    </div>
  )
}

function Output({ text }: { text: string }): JSX.Element {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml
    disallowedElements={['img']} components={{ a: ({ children }) => <span>{children}</span> }}>{text}</ReactMarkdown>
}
