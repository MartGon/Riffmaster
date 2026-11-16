/** A fretted or open note to draw on the neck. */
export interface NeckDot {
  /** String counted from the top of the diagram (the highest-sounding string) from 0. */
  row: number
  /** Fret on the instrument, 0 for an open string; includes the capo. */
  fret: number
  midi: number
  dead: boolean
  /** The tab note's id, for looking up its fingering. */
  id: number
}

interface NoteLike {
  id: number
  string: number
  fret: number
  realValue: number
  isDead: boolean
}

/**
 * Places a beat's notes on the neck. In the tab file strings are counted
 * from the lowest-sounding one, starting at 1, and frets from the capo.
 */
export function neckDots(notes: NoteLike[], stringCount: number, capo: number): NeckDot[] {
  const dots: NeckDot[] = []
  for (const note of notes) {
    const row = stringCount - note.string
    if (row < 0 || row >= stringCount || note.fret < 0) continue
    dots.push({ row, fret: note.fret + capo, midi: note.realValue, dead: note.isDead, id: note.id })
  }
  return dots
}

/** Frets that carry an inlay dot on most necks; the octave frets carry two. */
export const INLAY_FRETS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]

/** How many frets to draw: enough for the highest note used, at least 12 and at most 24. */
export function fretSpan(highestFret: number): number {
  return Math.min(24, Math.max(12, highestFret + 1))
}
