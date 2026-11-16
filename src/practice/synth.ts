/** A note for the test synthesizer. */
export interface SynthNote {
  timeSec: number
  midi: number
  /** How long the string rings before it is damped; defaults to ringing out. */
  durationSec?: number
  /** Legato notes change pitch without a new pick attack. */
  legato?: boolean
}

const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

/** Small deterministic noise source so tests give the same result every run. */
function noise(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 31 - 1
  }
}

/**
 * Renders a rough plucked-string sound: a short burst of pick noise followed
 * by decaying harmonics. It is used to test note detection without a guitar.
 */
export function synthesize(
  notes: SynthNote[],
  sampleRate: number,
  totalSec: number,
  options: { noiseFloor?: number } = {},
): Float32Array {
  const out = new Float32Array(Math.ceil(totalSec * sampleRate))
  const random = noise(12345)
  let phaseCarry = 0

  notes.forEach((note, index) => {
    const start = Math.round(note.timeSec * sampleRate)
    const hz = midiToHz(note.midi)
    const next = notes[index + 1]
    // A legato note takes over from the one before it, which stops ringing.
    const cutAt = next?.legato ? Math.round(next.timeSec * sampleRate) : Infinity
    const end = Math.min(
      out.length,
      cutAt,
      start + Math.round((note.durationSec ?? 2.5) * sampleRate),
    )
    const phase = note.legato ? phaseCarry : 0
    for (let i = start; i < end; i++) {
      const t = (i - start) / sampleRate
      let sample = 0
      for (let k = 1; k <= 6; k++) {
        if (hz * k > sampleRate / 2) break
        sample += (Math.sin(2 * Math.PI * hz * k * t + phase * k) / k) * Math.exp(-t * (1.2 + k * 0.9))
      }
      const fadeOut = Math.min(1, (end - i) / (0.01 * sampleRate))
      const attack = note.legato ? 1 : Math.min(1, t / 0.002)
      out[i] += 0.3 * sample * attack * fadeOut
      if (!note.legato && t < 0.006) out[i] += 0.25 * random() * (1 - t / 0.006)
    }
    phaseCarry = phase + 2 * Math.PI * hz * ((end - start) / sampleRate)
  })

  const floor = options.noiseFloor ?? 0
  if (floor > 0) for (let i = 0; i < out.length; i++) out[i] += floor * random()
  return out
}
