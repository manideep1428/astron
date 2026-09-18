import React, { useState, useEffect } from 'react'
import { Mic, Key, Check, Sparkles, Laptop, CheckCircle2, HelpCircle } from 'lucide-react'
import { isMac, assistantShortcut, assistantStopInstruction, shortcutAction } from '../utils/platform'
import '../assets/dashboard.css'
import { AgentHub } from './AgentHub'
import { LiveVoiceButton } from './LiveVoiceButton'

const ComputerUseSettingsPanel: React.FC = () => {
  const [s, setS] = useState({
    mode: 'auto' as 'ask' | 'my-computer' | 'detached' | 'auto',
    maxAgents: 3,
    execution: 'parallel' as 'sequential' | 'parallel',
    askBeforeSensitive: true,
    showActivity: true,
    allowAgentComms: true
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.astronApi
      ?.getAgentSettings?.()
      .then((v) => setS({ ...s, ...v }))
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = async (patch: Partial<typeof s>): Promise<void> => {
    const next = { ...s, ...patch }
    setS(next)
    try {
      const updated = await window.astronApi.saveAgentSettings(patch)
      setS({ ...next, ...updated })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1500)
    } catch {
      // keep local value
    }
  }

  return (
    <div
      style={{
        background: 'rgba(15,23,42,0.6)',
        borderRadius: '16px',
        padding: '20px',
        border: '1px solid rgba(255,255,255,0.08)',
        marginTop: '14px'
      }}
    >
      <h3 style={{ margin: '0 0 12px 0', fontSize: '15px' }}>
        Computer Use {saved && <span style={{ color: '#34d399', fontSize: '12px' }}>Â· saved</span>}
      </h3>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {(['ask', 'my-computer', 'detached', 'auto'] as const).map((m) => (
          <button key={m} onClick={() => void save({ mode: m })} style={modeBtn(s.mode === m)}>
            {m === 'ask'
              ? 'Ask each time'
              : m === 'my-computer'
                ? 'Always use my computer'
                : m === 'detached'
                  ? 'Always detached'
                  : 'Auto'}
          </button>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          gap: '14px',
          alignItems: 'center',
          flexWrap: 'wrap',
          fontSize: '13px',
          color: '#cbd5e1'
        }}
      >
        <label>
          Agents{' '}
          <select
            value={s.maxAgents}
            onChange={(e) => void save({ maxAgents: Number(e.target.value) })}
            style={miniSelect}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="radio"
            checked={s.execution === 'sequential'}
            onChange={() => void save({ execution: 'sequential' })}
          />{' '}
          Sequential
        </label>
        <label>
          <input
            type="radio"
            checked={s.execution === 'parallel'}
            onChange={() => void save({ execution: 'parallel' })}
          />{' '}
          Parallel
        </label>
        <label>
          <input
            type="checkbox"
            checked={s.askBeforeSensitive}
            onChange={(e) => void save({ askBeforeSensitive: e.target.checked })}
          />{' '}
          Ask before sensitive
        </label>
        <label>
          <input
            type="checkbox"
            checked={s.showActivity}
            onChange={(e) => void save({ showActivity: e.target.checked })}
          />{' '}
          Show activity
        </label>
        <label>
          <input
            type="checkbox"
            checked={s.allowAgentComms}
            onChange={(e) => void save({ allowAgentComms: e.target.checked })}
          />{' '}
          Agents communicate
        </label>
      </div>
    </div>
  )
}

function modeBtn(on: boolean): React.CSSProperties {
  return {
    background: on ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)',
    color: '#e2e8f0',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '999px',
    padding: '6px 12px',
    fontSize: '12px',
    cursor: 'pointer'
  }
}

const stepBadge: React.CSSProperties = {
  width: '28px',
  height: '28px',
  borderRadius: '50%',
  background: 'rgba(99, 102, 241, 0.2)',
  color: '#818CF8',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 700,
  flexShrink: 0
}


const miniSelect: React.CSSProperties = {
  background: '#0f172a',
  color: '#e2e8f0',
  borderRadius: '6px',
  padding: '4px 8px',
  border: '1px solid rgba(255,255,255,0.12)'
}

export const Dashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    'playground' | 'agents' | 'settings' | 'guide'
  >('agents')
  const [config, setConfig] = useState<{
    openaiApiKey: string
    apiUrl: string
    language: string
  }>({
    openaiApiKey: '',
    apiUrl: 'https://api.openai.com/v1/audio/transcriptions',
    language: 'en'
  })

  const [tokenInput, setTokenInput] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  const loadConfig = async (): Promise<void> => {
    if (window.astronApi?.getConfig) {
      const cfg = await window.astronApi.getConfig()
      setConfig(cfg)
      setTokenInput(cfg.openaiApiKey || '')
    }
  }

  useEffect(() => {
    // State is only mutated after the IPC calls resolve, never during the effect.
    const hydrate = async (): Promise<void> => {
      await loadConfig()
    }

    void hydrate()
  }, [])

  const handleSaveSettings = async (): Promise<void> => {
    if (window.astronApi?.saveConfig) {
      const updated = await window.astronApi.saveConfig({
        openaiApiKey: tokenInput.trim()
      })
      setConfig(updated)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    }
  }


  return (
    <div className="astron-home">
      <aside className="home-sidebar">
        <a className="home-brand" href="#agents">
          <span>
            <Sparkles size={23} />
          </span>
          Astron
        </a>
        <p className="home-eyebrow">YOUR WORKSPACE</p>
        <nav aria-label="Workspace sections">
          {(
            [
              ['agents', Laptop, 'Agent hub'],
              ['playground', Mic, 'Live voice'],
              ['settings', Key, 'Settings'],
              ['guide', HelpCircle, 'Quick guide']
            ] as const
          ).map(([id, Icon, label]) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={activeTab === id ? 'location' : undefined}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="home-background-note">
          <span className="home-status-dot" />
          Background companion
          <p>Close this window to keep working. Open Astron again from the {isMac ? 'menu bar' : 'tray'}.</p>
          <kbd>{assistantShortcut}</kbd>
          <small>{isMac ? 'Tap to start; tap again to send' : 'Hold to ask your assistant'}</small>

  return <div>Dashboard</div>
}
