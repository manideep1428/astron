import React, { useEffect, useRef, useState } from 'react'
import { hubSocket } from '../utils/hubSocket'

type VoiceStatus = 'idle' | 'ws-open' | 'listening' | 'streaming' | 'error'

/**
 * Immediate voice entry: connects the local WS hub on mount and streams
 * 16kHz mic chunks over it. Main forwards state to overlay; this is the
 * transport GPT-Live-1 / Astra realtime will ride (no polling, no per-tap IPC).
 */
export const LiveVoiceButton: React.FC = () => {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [level, setLevel] = useState(0)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const procRef = useRef<ScriptProcessorNode | null>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    const off = hubSocket.onVoiceState((s) => {
      if (s === 'open' || s === 'ws-open') setStatus('ws-open')
    })
    const off2 = window.astronApi?.onVoiceWsState?.((s) => {
      if (s === 'listening' || s === 'streaming' || s === 'idle') setStatus(s as VoiceStatus)
    })
    return (): void => {
      off?.()
      off2?.()
      void stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = async (): Promise<void> => {
    try {
      setStatus('listening')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
      })
      streamRef.current = stream
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctor({ sampleRate: 16000 })
      ctxRef.current = ctx
      const src = ctx.createMediaStreamSource(stream)
      const proc = ctx.createScriptProcessor(4096, 1, 1)
      procRef.current = proc
      proc.onaudioprocess = (e): void => {
        const input = e.inputBuffer.getChannelData(0)
        let peak = 0
        for (let i = 0; i < input.length; i += 8) {
          const v = Math.abs(input[i])
          if (v > peak) peak = v
        }
        setLevel(Math.min(1, peak * 2))
        const pcm = new Int16Array(input.length)
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]))
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
        }
        let binary = ''
        const bytes = new Uint8Array(pcm.buffer)
        for (let i = 0; i < bytes.length; i += 1024) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 1024))
        }
        seqRef.current += 1
        hubSocket.sendVoiceChunk(seqRef.current, btoa(binary), 16000)
        if (seqRef.current === 2) {
          void hubSocket.rpc('voice:state', { state: 'streaming' }).catch(() => undefined)
          setStatus('streaming')
        }
      }
      src.connect(proc)
      proc.connect(ctx.destination)
    } catch {
      setStatus('error')
      window.setTimeout(() => setStatus('idle'), 1500)
    }
  }

  const stop = async (): Promise<void> => {
    try {
      procRef.current?.disconnect()
      procRef.current = null
      await ctxRef.current?.close().catch(() => undefined)
      ctxRef.current = null
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    } catch {
      // ignore
    }
    setLevel(0)
    setStatus('idle')
    void hubSocket.rpc('voice:state', { state: 'idle' }).catch(() => undefined)
  }

  const live = status === 'listening' || status === 'streaming'
  return (
    <button
      onClick={() => void (live ? stop() : start())}
      title={live ? 'Stop live voice (WS streaming)' : 'Start live voice (WS, instant)'}
      style={live ? onStyle(level) : offStyle}
    >
      {live ? `◉ LIVE ${Math.round(level * 100)}%` : '◎ Live Voice (WS)'}
    </button>
  )
}

const offStyle: React.CSSProperties = {
  background: 'rgba(56,189,248,0.15)',
  color: '#7dd3fc',
  border: '1px solid rgba(56,189,248,0.35)',
  borderRadius: '999px',
  padding: '6px 14px',
  fontSize: '12px',
  fontWeight: 700,
  cursor: 'pointer'
}

function onStyle(level: number): React.CSSProperties {
  return {
    background: `rgba(239,68,68,${0.25 + level * 0.4})`,
    color: '#fff',
    border: '1px solid rgba(239,68,68,0.6)',
    borderRadius: '999px',
    padding: '6px 14px',
    fontSize: '12px',
    fontWeight: 800,
    cursor: 'pointer'
  }
}
