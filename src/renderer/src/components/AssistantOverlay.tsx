import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Bot } from 'lucide-react'
import { createAudioContext, encodeWAV, mergeChunks, resampleLinear } from '../utils/audio'
import { isMac, assistantShortcut, assistantStopInstruction, shortcutAction } from '../utils/platform'
import '../assets/assistant.css'

export function AssistantOverlay(): JSX.Element {
  const [label, setLabel] = useState(`${shortcutAction} ${assistantShortcut} to speak`)
  const [phase, setPhase] = useState('idle')

  useEffect(() => {
    let disposed = false
    let held = false
    let session = 0
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    let processor: ScriptProcessorNode | null = null
    let chunks: Float32Array[] = []
    let rate = 16000
    let hideTimer: ReturnType<typeof setTimeout> | undefined
    const cleanup = (): void => {
      processor?.disconnect()
      processor = null
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
      void context?.close().catch(() => undefined)
      context = null
    }
    const handle = async (state: { held: boolean; session: number }): Promise<void> => {
      if (disposed || state.session < session) return
      if (state.held) {
        if (held && state.session === session) return
        cleanup()
        clearTimeout(hideTimer)
        session = state.session
        held = true
        chunks = []
        setPhase('opening')
        setLabel('Opening microphone…')
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
          if (disposed || !held || session !== state.session) {
            mic.getTracks().forEach((track) => track.stop())
            return
          }
          stream = mic
          const ctx = createAudioContext()
          context = ctx
          rate = ctx.sampleRate
          const source = ctx.createMediaStreamSource(mic)
          const proc = ctx.createScriptProcessor(4096, 1, 1)
          processor = proc
          proc.onaudioprocess = (event): void => {
            if (held) chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
          }
          const mute = ctx.createGain()
          mute.gain.value = 0
          source.connect(proc)
          proc.connect(mute)
          mute.connect(ctx.destination)
          await ctx.resume()
          if (held && !disposed && session === state.session) {
            setPhase('listening')
            setLabel(`Listening… ${assistantStopInstruction}`)
          }
        } catch {
          if (disposed || session !== state.session) return
          held = false
          cleanup()
          setPhase('error')
          setLabel('Microphone unavailable. Check permissions.')
        }
        return
      }
      if (!held || state.session !== session) return
      held = false
      cleanup()
      const samples = resampleLinear(mergeChunks(chunks), rate, 16000)
      chunks = []
      if (samples.length < 4000) {
        setPhase('idle')
        setLabel(isMac ? 'Tap the shortcut, speak longer, then tap again to send' : 'Hold the shortcut a little longer to speak')
        return
      }
      setPhase('thinking')
      setLabel('Understanding your task…')
      try {
        await window.astronApi.submitAssistant({ session, audio: encodeWAV(samples, 16000), durationMs: Math.round(samples.length / 16) })
        if (disposed || session !== state.session) return
        setPhase('done')
        setLabel('Task started — working in the background')
        hideTimer = setTimeout(() => {
          void window.astronApi.dismissAssistant().catch(() => undefined)
        }, 1800)
      } catch (error) {
        if (disposed || session !== state.session) return
        setPhase('error')
        setLabel(error instanceof Error ? error.message : 'Could not start task')
      }
    }
    const off = window.astronApi.onAssistantHold((state) => { void handle(state) })
    void window.astronApi.getAssistantState().then(handle).catch(() => {
      if (!disposed) { setPhase('error'); setLabel('Voice overlay unavailable') }
    })
    return () => {
      disposed = true
      held = false
      off()
      clearTimeout(hideTimer)
      cleanup()
    }
  }, [])

  return <div className={`assistant-card assistant-${phase}`}>
    <div className="assistant-robot"><Bot size={30} aria-hidden="true" /></div>
    <div className="assistant-copy"><strong>Astron Assistant</strong><p role="status">{label}</p></div>
    <button aria-label="Dismiss assistant" title="Stop and dismiss" onClick={() => void window.astronApi.dismissAssistant().catch(() => undefined)}>×</button>
  </div>
}
