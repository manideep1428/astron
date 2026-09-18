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
        </div>
      </aside>
      <main className="home-main" id="home-content">
        <header className="home-topbar">
          <span>
            Workspace <span>/ Overview</span>
          </span>
          <span className="home-local">Desktop assistant</span>
        </header>
        <div className="home-intro">
          <div>
            <p className="home-eyebrow">LESS BUSYWORK. MORE FLOW.</p>
            <h1>Make room for your next idea.</h1>
            <p>Delegate a task, think out loud, and keep everything in one place.</p>
          </div>
          <a className="home-primary" href="#agents" onClick={() => setActiveTab('agents')}>
            <Sparkles size={16} />
            Start a task
          </a>
        </div>
        <div className="home-overview">
          <a href="#agents">
            <Laptop size={20} />
            <div>
              <strong>Your agent workspace</strong>
              <span>Plan, run, and review tasks</span>
            </div>
          </a>
          <a href="#playground">
            <Mic size={20} />
            <div>
              <strong>Speak your mind</strong>
              <span>Live voice with GPT</span>
            </div>
          </a>
          <a href="#settings">
            <Key size={20} />
            <div>
              <strong>{config.openaiApiKey ? 'Voice key saved' : 'Finish voice setup'}</strong>
              <span>
                {config.openaiApiKey ? 'Manage your preferences' : 'Add your OpenAI API key'}
              </span>
            </div>
          </a>
        </div>
        <section id="agents" className="home-section">
          <div className="home-section-heading">
            <div>
              <p className="home-eyebrow">01 / DELEGATE</p>
              <h2>Agent hub</h2>
            </div>
            <span>Give your agents a goal. Follow their progress here.</span>
          </div>
          <div className="home-panel">
            <AgentHub />
          </div>
        </section>
        <section id="playground" className="home-section">
          <div className="home-section-heading">
            <div>
              <p className="home-eyebrow">02 / SPEAK</p>
              <h2>Live voice</h2>
            </div>
            <LiveVoiceButton />
          </div>
          <p className="home-description">
            Stream microphone audio with Live Voice, or hold {assistantShortcut} to speak a task.
            Speech is transcribed with OpenAI and answered by the same GPT model your agents use.
          </p>
        </section>

        <section id="settings" className="home-section">
          <div className="home-section-heading">
            <div>
              <p className="home-eyebrow">03 / PERSONALIZE</p>
              <h2>Settings</h2>
            </div>
            <span>Your voice, your preferences, your control.</span>
          </div>
          <ComputerUseSettingsPanel />
          <div className="home-settings-grid">
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.6)',
                borderRadius: '16px',
                padding: '24px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                marginBottom: '20px'
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}
              >
                <Key size={18} color="#818CF8" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
                  OpenAI API Configuration
                </h3>
              </div>

              <div style={{ marginBottom: '18px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    marginBottom: '6px',
                    color: '#E2E8F0'
                  }}
                >
                  OpenAI API Key:
                </label>
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="sk-..."
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '8px',
                    padding: '10px 14px',
                    color: '#F8FAFC',
                    fontSize: '13px',
                    outline: 'none'
                  }}
                />
                <span
                  style={{ fontSize: '11px', color: '#64748B', marginTop: '4px', display: 'block' }}
                >
                  Used for speech transcription and agents. Saved locally in plaintext (not
                  encrypted). Prefer <code>OPENAI_API_KEY</code> in your environment for security;
                  leave this field empty to use it.
                </span>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    marginBottom: '6px',
                    color: '#E2E8F0'
                  }}
                >
                  Endpoint URL:
                </label>
                <input
                  type="text"
                  readOnly
                  value="https://api.openai.com/v1/audio/transcriptions"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '8px',
                    padding: '10px 14px',
                    color: '#94A3B8',
                    fontSize: '13px',
                    fontFamily: 'monospace'
                  }}
                />
              </div>

              <button
                onClick={handleSaveSettings}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
                  color: '#fff',
                  border: 'none',
                  padding: '10px 22px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)'
                }}
              >
                {saveSuccess ? <CheckCircle2 size={16} /> : <Check size={16} />}
                {saveSuccess ? 'Saved Successfully!' : 'Save Settings'}
              </button>
            </div>

          </div>
        </section>

        <section id="guide" className="home-section">
          <div className="home-section-heading">
            <div>
              <p className="home-eyebrow">03 / GUIDE</p>
              <h2>Quick guide</h2>
            </div>
            <span>Delegate work, talk to your agents, and keep your hands on the keyboard.</span>
          </div>
          <div className="home-panel">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', gap: '14px' }}>
                <span style={stepBadge}>1</span>
                <div>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '15px' }}>Delegate a task</h4>
                  <p style={{ margin: 0, fontSize: '13px', color: '#94A3B8', lineHeight: 1.5 }}>
                    Describe a goal in the Agent hub, choose 1-5 agents, and follow progress,
                    screenshots, findings, and the merged summary while they work.
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '14px' }}>
                <span style={stepBadge}>2</span>
                <div>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '15px' }}>
                    {shortcutAction} <code style={{ color: '#A5B4FC' }}>{assistantShortcut}</code> to
                    talk to your agents
                  </h4>
                  <p style={{ margin: 0, fontSize: '13px', color: '#94A3B8', lineHeight: 1.5 }}>
                    The assistant card opens without stealing focus. {assistantStopInstruction}, and
                    the transcript starts a background agent run.
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '14px' }}>
                <span style={stepBadge}>3</span>
                <div>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '15px' }}>Keep Live voice open</h4>
                  <p style={{ margin: 0, fontSize: '13px', color: '#94A3B8', lineHeight: 1.5 }}>
                    Live Voice streams microphone audio over the local hub to the same GPT reply
                    path. Command-like speech is handed to agents automatically.
                  </p>
                </div>
              </div>

              {isMac && (
                <div className="home-description">
                  <h3>macOS permissions</h3>
                  <p>
                    Allow Astron access to Microphone for voice tasks and Live Voice. Screen
                    Recording is only needed by browser agents that capture screenshots.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

      </main>
    </div>
  )
}
