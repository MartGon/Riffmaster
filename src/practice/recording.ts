import { encodeWav } from './takeFile'

/**
 * Recordings of takes, kept so they can be listened to under the tab. They
 * are cut to the pass, made smaller (a guitar needs little above 10 kHz)
 * and brought up to a steady level.
 */

export const RECORDING_RATE = 24000
/** Kept before the first note and after the last, in ms, so the take's start and the last ring are heard. */
export const LEAD_MS = 500
export const TAIL_MS = 1500
/** How loud the loudest moment is made, and how far a quiet input is brought up. */
const PEAK = 0.8
const MAX_GAIN = 20

/**
 * A stretch of the take, in seconds of its audio, as a small WAV file. Read
 * straight from the blocks at the lower rate, so a long take is not copied
 * whole first.
 */
export function encodeRecording(blocks: Float32Array[], sampleRate: number, fromSec: number, toSec: number): Uint8Array<ArrayBuffer> {
  const from = Math.max(0, Math.floor(fromSec * sampleRate))
  const total = blocks.reduce((sum, block) => sum + block.length, 0)
  const to = Math.min(total, Math.ceil(toSec * sampleRate))
  const ratio = sampleRate / RECORDING_RATE
  const out = new Float32Array(Math.max(0, Math.floor((to - from) / ratio)))
  // Walks the blocks once, averaging the input each output sample covers.
  let block = 0
  let blockStart = 0
  const seek = (position: number) => {
    while (block < blocks.length && blockStart + blocks[block].length <= position) blockStart += blocks[block++].length
  }
  for (let i = 0; i < out.length; i++) {
    const start = from + Math.floor(i * ratio)
    const end = Math.min(to, from + Math.max(Math.floor(i * ratio) + 1, Math.floor((i + 1) * ratio)))
    let sum = 0
    for (let position = start; position < end; position++) {
      seek(position)
      sum += blocks[block]?.[position - blockStart] ?? 0
    }
    out[i] = end > start ? sum / (end - start) : 0
  }
  return encodeWav([normalizeInPlace(out)], RECORDING_RATE)
}

function normalizeInPlace(samples: Float32Array): Float32Array {
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  if (peak === 0) return samples
  const gain = Math.min(MAX_GAIN, PEAK / peak)
  for (let i = 0; i < samples.length; i++) samples[i] *= gain
  return samples
}
