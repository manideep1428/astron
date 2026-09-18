import React, { useEffect, useState } from 'react'
import { useAgents } from '../stores/useAgents'
import { hubSocket } from '../utils/hubSocket'

function statusColor(s: string): string {
  if (s === 'completed') return '#34d399'
  if (s === 'failed') return '#f87171'
  if (s === 'waiting-approval') return '#fbbf24'
  if (s === 'paused') return '#94a3b8'
  return '#38bdf8'
}

export const btnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  color: '#e2e8f0',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '7px',
  padding: '5px 10px',
  fontSize: '12px',
  cursor: 'pointer'
}

export const AgentHub: React.FC = () => {
  const { runs, activeRunId, setActiveRun, screenshots, summaries, refresh, applyEvent } = useAgents()
  const [task, setTask] = useState('')
  const [count, setCount] = useState(3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void refresh()
    const offWs = hubSocket.onEvent((ev) => applyEvent(ev))
    const off = window.astronApi?.onAgentEvent?.((ev) => applyEvent(ev))
    return (): void => {
      offWs?.()
      off?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const active = runs.find((r) => r.id === activeRunId) ?? runs[0]
  const activeCount = runs.filter((r) => r.status === 'running' || r.status === 'paused').length

  const start = async (): Promise<void> => {
    if (!task.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      let run: { id: string }
      try {
        run = await hubSocket.rpc<{ id: string }>('agent:create', { task: task.trim(), count })
      } catch {
        run = await window.astronApi.createAgentRun({ task: task.trim(), count })
      }
      setActiveRun(run.id)
      setTask('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={barStyle}>
        <div title="Active runs" style={dotStyle}>
          ● {activeCount}
        </div>
        <input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void start()
          }}
          placeholder="Try: Research OpenAI Agents SDK docs and compare modes"
          style={inputStyle}
        />
        <select value={count} onChange={(e) => setCount(Number(e.target.value))} style={selectStyle}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} agent{n > 1 ? 's' : ''}
            </option>
          ))}

  return <div>Hub</div>
}
