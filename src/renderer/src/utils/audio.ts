// WAV encoder for Web Audio API AudioBuffer
export function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  // RIFF identifier
  writeString(view, 0, 'RIFF')
  // file length
  view.setUint32(4, 36 + samples.length * 2, true)
  // RIFF type
  writeString(view, 8, 'WAVE')
  // format chunk identifier
  writeString(view, 12, 'fmt ')
  // format chunk length
  view.setUint32(16, 16, true)
  // sample format (1 is PCM)
  view.setUint16(20, 1, true)
  // channel count (1 for mono)
  view.setUint16(22, 1, true)
  // sample rate
  view.setUint32(24, sampleRate, true)
  // byte rate (sampleRate * 1 * 2)
  view.setUint32(28, sampleRate * 2, true)
  // block align (1 * 2)
  view.setUint16(32, 2, true)
  // bits per sample
  view.setUint16(34, 16, true)
  // data chunk identifier
  writeString(view, 36, 'data')
  // data chunk length
  view.setUint32(40, samples.length * 2, true)

  // Write 16-bit PCM samples
  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return buffer
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

/** Safari/older Chromium expose the constructor under `webkitAudioContext`. */
export function createAudioContext(): AudioContext {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

  if (!Ctor) {
    throw new Error('Web Audio API is not supported in this environment')
  }

  return new Ctor()
}

/** Concatenates the PCM blocks produced by the ScriptProcessor node. */
export function mergeChunks(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const merged = new Float32Array(totalLength)

  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }

  return merged
}

/**
 * Linear resampler. Microphone AudioContexts usually run at 44.1/48 kHz and
 * sending that to the API while claiming 16 kHz garbles the transcript.
 */
export function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (samples.length === 0 || fromRate <= 0 || toRate <= 0 || fromRate === toRate) {
    return samples
  }

  const ratio = fromRate / toRate
  const outputLength = Math.max(1, Math.round(samples.length / ratio))
  const output = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio
    const index = Math.floor(position)
    const nextIndex = Math.min(index + 1, samples.length - 1)
    const fraction = position - index
    output[i] = samples[index] * (1 - fraction) + samples[nextIndex] * fraction
  }

  return output
}
