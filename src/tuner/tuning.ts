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

/** Pitch names as guitarists name tunings: "E♭ standard", "Drop C♯". */
const TUNING_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']

function tuningNote(midi: number): string {
  return TUNING_NAMES[((Math.round(midi) % 12) + 12) % 12]
}

/** Semitones from each string to the next higher one in standard tuning, lowest string first. */
const STANDARD_STEPS: Record<number, number[]> = {
  4: [5, 5, 5],
  5: [5, 5, 5, 5],
  6: [5, 5, 5, 4, 5],
  7: [5, 5, 5, 5, 4, 5],
  8: [5, 5, 5, 5, 5, 4, 5],
}
/** Which string, counted from the lowest, names a standard tuning: the one at E in E standard. */
const NAMING_STRING: Record<number, number> = { 4: 0, 5: 1, 6: 0, 7: 1, 8: 2 }

/**
 * A short name for a tuning given highest string first, as tracks store it:
 * "E standard", "E♭ standard", "Drop D", or else the notes from the lowest
 * string up, such as "D A D G A D".
 */
export function tuningName(tuning: number[]): string {
  const low = [...tuning].reverse()
  const steps = low.slice(1).map((midi, i) => midi - low[i])
  const standard = STANDARD_STEPS[low.length]
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i])
  if (standard && same(steps, standard)) return `${tuningNote(low[NAMING_STRING[low.length]])} standard`
  if (standard && steps[0] === 7 && same(steps.slice(1), standard.slice(1))) return `Drop ${tuningNote(low[0])}`
  return low.map(tuningNote).join(' ')
}
