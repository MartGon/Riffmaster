/** Ticks in a quarter note, as alphaTab counts them. */
export const QUARTER = 960
const WHOLE = QUARTER * 4

/** Note values the editor offers, as alphaTab's duration numbers (4 is a quarter). */
export const NOTE_VALUES = [1, 2, 4, 8, 16, 32, 64] as const
export type NoteValue = (typeof NOTE_VALUES)[number]

export interface Rhythm {
  value: NoteValue
  /** 0, 1 or 2 dots. */
  dots: number
  triplet: boolean
  /**
   * A tuplet other than a triplet read from the file, e.g. [5, 4] for five
   * in the time of four. It is kept as it is; the editor only writes triplets.
   */
  tuplet?: [number, number]
}

export const defaultRhythm: Rhythm = { value: 4, dots: 0, triplet: false }

export function rhythmTicks({ value, dots, triplet, tuplet }: Rhythm): number {
  let ticks = WHOLE / value
  if (dots === 1) ticks *= 1.5
  else if (dots === 2) ticks *= 1.75
  if (tuplet) ticks = (ticks * tuplet[1]) / tuplet[0]
  else if (triplet) ticks = (ticks * 2) / 3
  return ticks
}

export function barTicks(numerator: number, denominator: number): number {
  return (numerator * WHOLE) / denominator
}

/** The next longer (-1) or shorter (+1) note value, staying within the offered range. */
export function stepValue(value: NoteValue, direction: -1 | 1): NoteValue {
  const index = NOTE_VALUES.indexOf(value)
  const next = Math.min(NOTE_VALUES.length - 1, Math.max(0, index + direction))
  return NOTE_VALUES[next]
}

const VALUE_NAMES: Record<NoteValue, [string, string]> = {
  1: ['whole note', 'whole notes'],
  2: ['half note', 'half notes'],
  4: ['quarter note', 'quarter notes'],
  8: ['eighth note', 'eighth notes'],
  16: ['sixteenth note', 'sixteenth notes'],
  32: ['32nd note', '32nd notes'],
  64: ['64th note', '64th notes'],
}

export function describeRhythm(rhythm: Rhythm, rest = false): string {
  const name = VALUE_NAMES[rhythm.value][0]
  const dotted = rhythm.dots === 1 ? 'dotted ' : rhythm.dots === 2 ? 'double-dotted ' : ''
  const triplet = rhythm.tuplet ? `${rhythm.tuplet[0]}:${rhythm.tuplet[1]} tuplet ` : rhythm.triplet ? 'triplet ' : ''
  const kind = rest ? name.replace('note', 'rest') : name
  return `${dotted}${triplet}${kind}`
}

/** A length in ticks in words, e.g. "1 eighth note" or "3 sixteenth notes". */
export function describeTicks(ticks: number): string {
  for (const value of NOTE_VALUES) {
    const unit = WHOLE / value
    if (ticks % unit === 0) {
      const count = ticks / unit
      return `${count} ${VALUE_NAMES[value][count === 1 ? 0 : 1]}`
    }
  }
  for (const value of NOTE_VALUES) {
    const unit = (WHOLE / value) * (2 / 3)
    if (ticks % unit === 0) {
      const count = ticks / unit
      return `${count} triplet ${VALUE_NAMES[value][count === 1 ? 0 : 1]}`
    }
  }
  return `${Math.round((ticks / QUARTER) * 100) / 100} beats`
}

/**
 * Plain note values that add up to `ticks`, longest first, for filling a bar
 * with rests. Whatever cannot be expressed with them is left out.
 */
export function fillValues(ticks: number): NoteValue[] {
  const result: NoteValue[] = []
  let left = ticks
  for (const value of NOTE_VALUES) {
    const unit = WHOLE / value
    while (left >= unit) {
      result.push(value)
      left -= unit
    }
  }
  return result
}

/** How full a bar is, as a short sentence, or null when it is exactly full. */
export function describeFill(used: number, length: number): string | null {
  // Tuplets such as 9:8 add up to a whole bar only up to rounding.
  used = Math.round(used)
  length = Math.round(length)
  if (used === length) return null
  if (used === 0) return 'Empty bar'
  if (used < length) return `Bar is ${describeTicks(length - used)} short`
  return `Bar is ${describeTicks(used - length)} too long`
}
