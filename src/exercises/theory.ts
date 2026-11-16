// Where scales and arpeggios sit on a guitar in standard tuning.

/** Open strings, lowest first, as MIDI notes. */
export const OPEN = [40, 45, 50, 55, 59, 64]

/** A fretted or open note. Strings are counted from the lowest, starting at 1. */
export interface Place {
  string: number
  fret: number
}

export const pitchOf = (place: Place): number => OPEN[place.string - 1] + place.fret

/**
 * One way to play a scale without moving the hand: the scale note the
 * lowest string starts on, and how many notes each string takes, lowest
 * string first.
 */
export interface Shape {
  /** Index into the scale's notes; 0 is the root. */
  start: number
  perString: number[]
}

export interface Scale {
  id: string
  /** Follows the key, as in "A minor pentatonic". */
  name: string
  /** Semitones above the root. */
  intervals: number[]
  /** The usual positions, going up the neck from the one that starts on (or just under) the root. */
  shapes: Shape[]
  /** A note added to the shapes where it falls under the hand, in semitones above the root. */
  extra?: number
  minor: boolean
}

const twoPerString = (start: number): Shape => ({ start, perString: [2, 2, 2, 2, 2, 2] })
const BOXES = [0, 1, 2, 3, 4].map(twoPerString)

export const SCALES: Scale[] = [
  { id: 'minor-pentatonic', name: 'minor pentatonic', intervals: [0, 3, 5, 7, 10], shapes: BOXES, minor: true },
  { id: 'major-pentatonic', name: 'major pentatonic', intervals: [0, 2, 4, 7, 9], shapes: BOXES, minor: false },
  { id: 'blues', name: 'blues', intervals: [0, 3, 5, 7, 10], shapes: BOXES, extra: 6, minor: true },
  {
    id: 'major',
    name: 'major',
    intervals: [0, 2, 4, 5, 7, 9, 11],
    // The five positions often named after the open chords C, A, G, E and D.
    shapes: [
      { start: 6, perString: [3, 3, 3, 3, 2, 3] },
      { start: 1, perString: [3, 2, 3, 3, 3, 3] },
      { start: 2, perString: [3, 3, 3, 2, 3, 3] },
      { start: 4, perString: [2, 3, 3, 3, 3, 2] },
      { start: 5, perString: [3, 3, 2, 3, 3, 3] },
    ],
    minor: false,
  },
  {
    id: 'minor',
    name: 'natural minor',
    intervals: [0, 2, 3, 5, 7, 8, 10],
    // The same five positions as the major scale three frets up.
    shapes: [
      { start: 0, perString: [3, 3, 2, 3, 3, 3] },
      { start: 1, perString: [3, 3, 3, 3, 2, 3] },
      { start: 3, perString: [3, 2, 3, 3, 3, 3] },
      { start: 4, perString: [3, 3, 3, 2, 3, 3] },
      { start: 6, perString: [2, 3, 3, 3, 3, 2] },
    ],
    minor: true,
  },
]

/** Key names by semitones above C, as usually written for major and for minor keys. */
export const MAJOR_KEYS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
export const MINOR_KEYS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B']

const mod12 = (value: number): number => ((value % 12) + 12) % 12

/** Moves a pattern up an octave when it would otherwise fall below the open strings. */
function onTheNeck(places: Place[]): Place[] {
  const lowest = Math.min(...places.map((place) => place.fret))
  return lowest < 0 ? places.map((place) => ({ ...place, fret: place.fret + 12 })) : places
}

/**
 * The notes of one position of a scale, lowest first.
 * `root` is in semitones above C; `position` counts from 0.
 */
export function scalePlaces(scale: Scale, root: number, position: number): Place[] {
  const shape = scale.shapes[position]
  const size = scale.intervals.length
  // The lowest note is the first one of its name on the sixth string.
  const lowest = OPEN[0] + mod12(root + scale.intervals[shape.start] - OPEN[0])
  const base = lowest - scale.intervals[shape.start]
  const places: Place[] = []
  let degree = shape.start
  shape.perString.forEach((count, index) => {
    for (let n = 0; n < count; n++) {
      const pitch = base + scale.intervals[degree % size] + 12 * Math.floor(degree / size)
      places.push({ string: index + 1, fret: pitch - OPEN[index] })
      degree++
    }
  })
  const placed = onTheNeck(places)
  return scale.extra === undefined ? placed : withExtraNote(placed, mod12(root + scale.extra))
}

/**
 * Adds every note of one name that lies within a pattern's range, each on
 * the string where it is nearest to the fingers already there.
 */
function withExtraNote(places: Place[], pitchClass: number): Place[] {
  const result = [...places]
  const low = pitchOf(places[0])
  const high = pitchOf(places[places.length - 1])
  for (let pitch = low + 1; pitch < high; pitch++) {
    if (mod12(pitch) !== pitchClass) continue
    let best: { place: Place; reach: number } | null = null
    for (let string = 1; string <= OPEN.length; string++) {
      const frets = places.filter((place) => place.string === string).map((place) => place.fret)
      const fret = pitch - OPEN[string - 1]
      if (fret < 0) continue
      const reach = Math.max(0, Math.min(...frets) - fret, fret - Math.max(...frets))
      // On a tie the thicker string wins: a reach up with the little
      // finger is easier than one down with the index finger.
      if (!best || reach < best.reach) best = { place: { string, fret }, reach }
    }
    if (best && best.reach <= 1) result.push(best.place)
  }
  return result.sort((a, b) => pitchOf(a) - pitchOf(b))
}

export interface Arpeggio {
  id: string
  label: string
  minor: boolean
  /** The string the root is on, counted from the lowest. */
  rootString: number
  /** Notes as string and frets away from the root's fret, lowest first. */
  notes: [string: number, offset: number][]
}

export const ARPEGGIOS: Arpeggio[] = [
  {
    id: 'major-6',
    label: 'Major, root on the 6th string',
    minor: false,
    rootString: 1,
    notes: [[1, 0], [2, -1], [2, 2], [3, 2], [4, 1], [5, 0], [6, 0]],
  },
  {
    id: 'minor-6',
    label: 'Minor, root on the 6th string',
    minor: true,
    rootString: 1,
    notes: [[1, 0], [1, 3], [2, 2], [3, 2], [4, 0], [5, 0], [6, 0]],
  },
  {
    id: 'major-5',
    label: 'Major, root on the 5th string',
    minor: false,
    rootString: 2,
    notes: [[2, 0], [3, -1], [3, 2], [4, 2], [5, 2], [6, 0]],
  },
  {
    id: 'minor-5',
    label: 'Minor, root on the 5th string',
    minor: true,
    rootString: 2,
    notes: [[2, 0], [2, 3], [3, 2], [4, 2], [5, 1], [6, 0]],
  },
]

/** The notes of an arpeggio shape for a root given in semitones above C, lowest first. */
export function arpeggioPlaces(arpeggio: Arpeggio, root: number): Place[] {
  const rootFret = mod12(root - OPEN[arpeggio.rootString - 1])
  return onTheNeck(arpeggio.notes.map(([string, offset]) => ({ string, fret: rootFret + offset })))
}

/** Open and barre chords, as the fret on each string from the lowest; -1 is a string left out. */
export const CHORDS: Record<string, { frets: number[]; barre?: number }> = {
  E: { frets: [0, 2, 2, 1, 0, 0] },
  A: { frets: [-1, 0, 2, 2, 2, 0] },
  D: { frets: [-1, -1, 0, 2, 3, 2] },
  G: { frets: [3, 2, 0, 0, 0, 3] },
  C: { frets: [-1, 3, 2, 0, 1, 0] },
  F: { frets: [1, 3, 3, 2, 1, 1], barre: 1 },
  Em: { frets: [0, 2, 2, 0, 0, 0] },
  Am: { frets: [-1, 0, 2, 2, 1, 0] },
  Dm: { frets: [-1, -1, 0, 2, 3, 1] },
  Bm: { frets: [-1, 2, 4, 4, 3, 2], barre: 2 },
  B7: { frets: [-1, 2, 1, 2, 0, 2] },
}

/** Chord sequences to practise changing between, one chord per step. */
export const PROGRESSIONS: string[][] = [
  ['G', 'C', 'D', 'G'],
  ['A', 'D', 'E', 'A'],
  ['E', 'A', 'B7', 'E'],
  ['Em', 'C', 'G', 'D'],
  ['G', 'D', 'Em', 'C'],
  ['C', 'Am', 'F', 'G'],
  ['Am', 'F', 'C', 'G'],
  ['Am', 'Dm', 'E', 'Am'],
  ['D', 'A', 'Bm', 'G'],
]
