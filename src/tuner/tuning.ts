const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

export function frequencyToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440)
}

/** Name of a pitch without its octave, e.g. "E" or "F♯". */
export function pitchClassName(midi: number): string {
  return NAMES[((Math.round(midi) % 12) + 12) % 12]
}

/** Name of a pitch with its octave, e.g. "E2" for the low string of a guitar. */
export function noteName(midi: number): string {
  const rounded = Math.round(midi)
  return `${pitchClassName(rounded)}${Math.floor(rounded / 12) - 1}`
}

export interface TuneReading {
  /** The pitch being tuned towards. */
  targetMidi: number
  /** Position of the matching string in the tuning, or null when no string is near. */
  string: number | null
  /** How far the sound is from the target, in cents; positive means sharp. */
  cents: number
}

/** A string is taken as the one being tuned when the sound is within this many semitones of it. */
const STRING_REACH = 3.5

/**
 * Works out what a sounding frequency is being tuned to: the nearest open
 * string of the instrument when one is close, otherwise the nearest note.
 */
export function readTuning(hz: number, tuning: number[]): TuneReading {
  const midi = frequencyToMidi(hz)
  let string: number | null = null
  for (let i = 0; i < tuning.length; i++) {
    const distance = Math.abs(midi - tuning[i])
    if (distance > STRING_REACH) continue
    if (string === null || distance < Math.abs(midi - tuning[string])) string = i
  }
  const targetMidi = string === null ? Math.round(midi) : tuning[string]
  return { targetMidi, string, cents: (midi - targetMidi) * 100 }
}

/** Within this many cents the string counts as in tune. */
export const IN_TUNE_CENTS = 5

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
