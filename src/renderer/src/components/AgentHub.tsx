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
        </select>
        <button onClick={() => void start()} disabled={busy || !task.trim()} style={runStyle(busy)}>
          {busy ? 'Starting…' : 'Run'}
        </button>
      </div>
      {error && <div style={{ color: '#f87171', fontSize: '12px' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {runs.slice(0, 6).map((r) => (
          <button key={r.id} onClick={() => setActiveRun(r.id)} style={chipStyle(r.id === active?.id)}>
            {(r.prompt || r.id).slice(0, 34)} · {r.status}
          </button>
        ))}
      </div>
      {!active && <div style={{ color: '#94a3b8', fontSize: '13px' }}>No agent runs yet.</div>}
      {active && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ fontWeight: 700, fontSize: '14px', color: '#fff', flex: 1 }}>{active.prompt}</div>
            <span style={{ fontSize: '12px', color: statusColor(active.status) }}>{active.status}</span>
            {active.status === 'running' && (
              <button onClick={() => void wsControl('agent:pause', { runId: active.id })} style={btnStyle}>Pause</button>
            )}
            {active.status === 'paused' && (
              <button onClick={() => void wsControl('agent:resume', { runId: active.id })} style={btnStyle}>Resume</button>
            )}
            {(active.status === 'running' || active.status === 'paused') && (
              <button onClick={() => void wsControl('agent:cancel', { runId: active.id })} style={{ ...btnStyle, background: 'rgba(248,113,113,0.2)' }}>Stop</button>
            )}
          </div>
          {active.agents.map((a) => (
            <div key={a.id} style={agentStyle}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ color: statusColor(a.status) }}>●</span>
                <strong style={{ fontSize: '13px', color: '#fff' }}>{a.role} · {a.mode === 'normal' ? 'My Computer' : a.environmentId}</strong>
                <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#94a3b8' }}>{a.progress}%</span>
              </div>
              <div style={{ fontSize: '12px', color: '#cbd5e1', marginTop: '4px' }}>{a.currentAction || a.task}</div>
              <div style={trackStyle}>
                <div style={{ width: `${Math.max(2, Math.min(100, a.progress))}%`, height: '100%', borderRadius: '999px', background: '#6366f1' }} />
              </div>
              {a.status === 'waiting-approval' && (
                <button onClick={() => void window.astronApi.approveAgent(active.id, a.id)} style={{ ...btnStyle, marginTop: '8px' }}>Approve local-PC step</button>
              )}
              {a.error && <div style={{ color: '#f87171', fontSize: '12px', marginTop: '6px' }}>{a.error}</div>}
              {screenshots[a.id] && (
                <img src={`data:image/png;base64,${screenshots[a.id]}`} alt="agent evidence" style={shotStyle} />
              )}
            </div>
          ))}
          {summaries[active.id] && <div style={summaryStyle}>{summaries[active.id]}</div>}
        </div>
      )}
    </div>
  )
}

const barStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '12px' }
const dotStyle: React.CSSProperties = { width: '40px', height: '34px', borderRadius: '999px', background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '13px', color: '#fff', flexShrink: 0 }
const inputStyle: React.CSSProperties = { flex: 1, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#e2e8f0', padding: '9px 12px', fontSize: '13px', outline: 'none' }
const selectStyle: React.CSSProperties = { background: '#0f172a', color: '#e2e8f0', borderRadius: '8px', padding: '8px', border: '1px solid rgba(255,255,255,0.12)' }
const cardStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }
const agentStyle: React.CSSProperties = { background: 'rgba(0,0,0,0.3)', borderRadius: '10px', padding: '10px 12px', border: '1px solid rgba(255,255,255,0.06)' }
const trackStyle: React.CSSProperties = { height: '5px', background: 'rgba(255,255,255,0.08)', borderRadius: '999px', marginTop: '8px' }
const shotStyle: React.CSSProperties = { marginTop: '8px', width: '100%', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }
const summaryStyle: React.CSSProperties = { fontSize: '12.5px', color: '#e2e8f0', whiteSpace: 'pre-wrap', background: 'rgba(99,102,241,0.12)', borderRadius: '8px', padding: '10px' }

function chipStyle(selected: boolean): React.CSSProperties {
  return { background: selected ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', borderRadius: '999px', padding: '5px 12px', fontSize: '12px', cursor: 'pointer' }
}

async function wsControl(method: string, params: unknown): Promise<void> {
  try {
    await hubSocket.rpc(method, params)
  } catch {
    if (method === 'agent:pause') await window.astronApi.pauseAgentRun((params as { runId: string }).runId)
    else if (method === 'agent:resume') await window.astronApi.resumeAgentRun((params as { runId: string }).runId)
    else if (method === 'agent:cancel') await window.astronApi.cancelAgentRun((params as { runId: string }).runId)
  }
}

function runStyle(busy: boolean): React.CSSProperties {
  return { background: busy ? '#475569' : '#6366f1', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 14px', fontWeight: 700, cursor: busy ? 'wait' : 'pointer', fontSize: '13px' }
}

