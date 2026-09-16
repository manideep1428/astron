/**
 * Audio crosses the IPC boundary before it reaches the STT client, and the shape
 * it arrives in depends on how the renderer serialised it (ArrayBuffer,
 * Uint8Array, Buffer, plain number array or a Buffer-like `{type,data}` object).
 * Normalising it here keeps the transcribe handler simple.
 */
export function toAudioBuffer(value: unknown): Buffer | null {
  if (!value) return null
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (Array.isArray(value)) return Buffer.from(value)

}
