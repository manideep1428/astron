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

  return <div>Assistant</div>
}
