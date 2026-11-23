import { buildSheet, type Sheet, type Step, type Tone } from './build'
import {
  ARPEGGIOS,
  arpeggioPlaces,
  CHORDS,
  MAJOR_KEYS,
  MINOR_KEYS,
  type Place,
  PROGRESSIONS,
  SCALES,
  type Scale,
  scalePlaces,
} from './theory'

export interface Choice {
  value: string
  label: string
}

/** Something to choose before an exercise is written out, such as its key. */
export interface Option {
  id: string
  label: string
  choices: Choice[]
  initial: string
}

export interface Exercise {
  id: string
  group: string
  name: string
  /** What it trains and how to play it. */
  about: string
  options: Option[]
  /** Writes the exercise out for the chosen values, keyed by option id. */
  make: (values: Record<string, string>) => Sheet
}

type Finger = 1 | 2 | 3 | 4
const FINGERS: Finger[] = [1, 2, 3, 4]
const EIGHTH = 2
const QUARTER = 4
/** Strings from the lowest to the highest, and back. */
const UP = [1, 2, 3, 4, 5, 6]
const DOWN = [6, 5, 4, 3, 2, 1]

const single = (tone: Tone, length = EIGHTH): Step => ({ tones: [tone], length })
const played = (places: Place[]): Step[] => places.map((place) => single(place))
const ordinal = (n: number): string => `${n}${['th', 'st', 'nd', 'rd'][n > 3 ? 0 : n]}`

function keyOption(names: string[], initial: number): Option {
  return {
    id: 'key',
    label: 'Key',
    choices: names.map((name, index) => ({ value: String(index), label: name })),
    initial: String(initial),
  }
}

const fretOption: Option = {
  id: 'fret',
  label: 'Starting fret',
  // Up to the ninth, so that no exercise goes past the fifteenth fret.
  choices: Array.from({ length: 9 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) })),
  // Frets are closer together here than at the nut, so the stretch is easier.
  initial: '5',
}

// Scales

/** Up to the top note and back down to the first. */
function upAndDown<T>(notes: T[]): T[] {
  return [...notes, ...notes.slice(0, -1).reverse()]
}

/** Four notes up from each note in turn, then four down from each. */
function inFours<T>(notes: T[]): T[] {
  const result: T[] = []
  for (let i = 0; i + 3 < notes.length; i++) result.push(...notes.slice(i, i + 4))
  for (let i = notes.length - 2; i >= 3; i--) result.push(notes[i], notes[i - 1], notes[i - 2], notes[i - 3])
  return result
}

/** Each note followed by the one two steps on, up and then down. */
function inThirds<T>(notes: T[]): T[] {
  const result: T[] = []
  for (let i = 0; i + 2 < notes.length; i++) result.push(notes[i], notes[i + 2])
  for (let i = notes.length - 2; i >= 2; i--) result.push(notes[i], notes[i - 2])
  return result
}

const PATTERNS: { id: string; label: string; title: string; order: <T>(notes: T[]) => T[] }[] = [
  { id: 'straight', label: 'Up and down', title: '', order: upAndDown },
  { id: 'fours', label: 'In fours', title: ', in fours', order: inFours },
  { id: 'thirds', label: 'Skipping a note', title: ', skipping a note', order: inThirds },
]

function scaleExercise(scale: Scale, about: string): Exercise {
  const keys = scale.minor ? MINOR_KEYS : MAJOR_KEYS
  return {
    id: scale.id,
    group: 'Scales',
    name: `${scale.name[0].toUpperCase()}${scale.name.slice(1)} scale`,
    about,
    options: [
      // A for the minor scales and C for the major ones.
      keyOption(keys, scale.minor ? 9 : 0),
      {
        id: 'position',
        label: 'Position',
        choices: scale.shapes.map((_, index) => ({ value: String(index), label: String(index + 1) })),
        initial: '0',
      },
      {
        id: 'pattern',
        label: 'Pattern',
        choices: PATTERNS.map((pattern) => ({ value: pattern.id, label: pattern.label })),
        initial: 'straight',
      },
    ],
    make: (values) => {
      const key = Number(values.key)
      const position = Number(values.position)
      const pattern = PATTERNS.find((item) => item.id === values.pattern) ?? PATTERNS[0]
      return {
        title: `${keys[key]} ${scale.name} scale, position ${position + 1}${pattern.title}`,
        tempo: 80,
        steps: played(pattern.order(scalePlaces(scale, key, position))),
      }
    },
  }
}

const SCALE_NOTES: Record<string, string> = {
  'minor-pentatonic':
    'The five-note scale behind most rock and blues solos. Position 1 starts on the root on the sixth string; the others follow up the neck.',
  'major-pentatonic':
    'The five-note major scale, common in country and classic rock. It uses the same five shapes as the minor pentatonic.',
  blues: 'The minor pentatonic with the flattened fifth added.',
  major: 'The seven-note major scale in its five positions. Position 1 has the root on the sixth string.',
  minor: 'The natural minor scale in its five positions. Position 1 starts on the root on the sixth string.',
}

// Finger exercises

/** Every order the four fingers can go in. */
function fingerOrders(): Finger[][] {
  const orders: Finger[][] = []
  const extend = (order: Finger[]) => {
    if (order.length === FINGERS.length) orders.push(order)
    else for (const finger of FINGERS) if (!order.includes(finger)) extend([...order, finger])
  }
  extend([])
  return orders
}

/** One finger per fret: the index finger plays `fret`, the next finger the fret above, and so on. */
const fingered = (string: number, fret: number, finger: Finger): Tone => ({ string, fret: fret + finger - 1, finger })

const spider: Exercise = {
  id: 'spider',
  group: 'Finger exercises',
  name: 'Spider: one finger per fret',
  about:
    'Four notes on each string, one finger per fret, up the strings and back down. The hand moves up a fret after each pass. Other finger orders train finger independence.',
  options: [
    fretOption,
    {
      id: 'order',
      label: 'Finger order',
      choices: fingerOrders().map((order) => ({ value: order.join(''), label: order.join('-') })),
      initial: '1234',
    },
  ],
  make: (values) => {
    const fret = Number(values.fret)
    const order = [...values.order].map(Number) as Finger[]
    const tones: Tone[] = []
    for (let pass = 0; pass < 4; pass++) {
      const rising = pass % 2 === 0
      for (const string of rising ? UP : DOWN) {
        for (const finger of rising ? order : [...order].reverse()) tones.push(fingered(string, fret + pass, finger))
      }
    }
    return { title: `Spider ${order.join('-')}, from fret ${fret}`, tempo: 60, steps: tones.map((tone) => single(tone)) }
  },
}

const spiderPairs: Exercise = {
  id: 'spider-pairs',
  group: 'Finger exercises',
  name: 'Spider: across two strings',
  about:
    'The fingers alternate between two neighbouring strings: first and third on one, second and fourth on the next. It trains the fingers to move separately.',
  options: [fretOption],
  make: (values) => {
    const fret = Number(values.fret)
    const tones: Tone[] = []
    for (let pass = 0; pass < 2; pass++) {
      const at = fret + pass
      for (const low of [1, 2, 3, 4, 5]) {
        tones.push(fingered(low, at, 1), fingered(low + 1, at, 2), fingered(low, at, 3), fingered(low + 1, at, 4))
      }
      for (const low of [5, 4, 3, 2, 1]) {
        tones.push(fingered(low + 1, at, 4), fingered(low, at, 3), fingered(low + 1, at, 2), fingered(low, at, 1))
      }
    }
    return { title: `Spider across two strings, from fret ${fret}`, tempo: 60, steps: tones.map((tone) => single(tone)) }
  },
}

const stringSkipping: Exercise = {
  id: 'string-skipping',
  group: 'Finger exercises',
  name: 'String skipping',
  about: 'One finger per fret, but the pick jumps over a string each time. It trains picking accuracy.',
  options: [fretOption],
  make: (values) => {
    const fret = Number(values.fret)
    const tones: Tone[] = []
    for (const string of [1, 3, 2, 4, 3, 5, 4, 6]) for (const finger of FINGERS) tones.push(fingered(string, fret, finger))
    for (const string of [6, 4, 5, 3, 4, 2, 3, 1]) {
      for (const finger of [...FINGERS].reverse()) tones.push(fingered(string, fret, finger))
    }
    return { title: `String skipping, from fret ${fret}`, tempo: 60, steps: tones.map((tone) => single(tone)) }
  },
}

const LEGATO_PAIRS: [Finger, Finger][] = [[1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]]

const legato: Exercise = {
  id: 'legato',
  group: 'Finger exercises',
  name: 'Hammer-ons and pull-offs',
  about:
    'Pick only the first note of each slur. With two fingers, each string gets a hammer-on and then a pull-off. With all four, hammer on going up the strings and pull off coming down.',
  options: [
    fretOption,
    {
      id: 'fingers',
      label: 'Fingers',
      choices: [
        ...LEGATO_PAIRS.map(([a, b]) => ({ value: `${a}${b}`, label: `${a} and ${b}` })),
        { value: '1234', label: 'All four' },
      ],
      initial: '13',
    },
  ],
  make: (values) => {
    const fret = Number(values.fret)
    const fingers = [...values.fingers].map(Number) as Finger[]
    const tones: Tone[] = []
    const slur = (string: number, order: Finger[]) =>
      order.forEach((finger, index) => {
        tones.push({ ...fingered(string, fret, finger), legato: index < order.length - 1 })
      })
    if (fingers.length === 2) {
      for (const string of [...UP, ...DOWN]) {
        slur(string, fingers)
        slur(string, [...fingers].reverse())
      }
    } else {
      for (const string of UP) slur(string, fingers)
      for (const string of DOWN) slur(string, [...fingers].reverse())
    }
    const name = fingers.length === 2 ? `fingers ${fingers.join(' and ')}` : 'all four fingers'
    return { title: `Hammer-ons and pull-offs, ${name}, from fret ${fret}`, tempo: 60, steps: tones.map((tone) => single(tone)) }
  },
}

const shifts: Exercise = {
  id: 'shifts',
  group: 'Finger exercises',
  name: 'Position shifts on one string',
  about:
    'Four notes with one finger per fret, then the whole hand moves up a fret and plays four more, up to the twelfth fret and back. It trains moving along the neck.',
  options: [
    {
      id: 'string',
      label: 'String',
      // Guitarists count strings from the thinnest; the file counts from the thickest.
      choices: DOWN.map((string) => ({ value: String(string), label: `${ordinal(7 - string)} string` })),
      initial: '6',
    },
  ],
  make: (values) => {
    const string = Number(values.string)
    const tones: Tone[] = []
    for (let fret = 1; fret <= 9; fret++) for (const finger of FINGERS) tones.push(fingered(string, fret, finger))
    for (let fret = 9; fret >= 1; fret--) {
      for (const finger of [...FINGERS].reverse()) tones.push(fingered(string, fret, finger))
    }
    return {
      title: `Position shifts on the ${ordinal(7 - string)} string`,
      tempo: 60,
      steps: tones.map((tone) => single(tone)),
    }
  },
}

// Arpeggios and chords

const arpeggios: Exercise = {
  id: 'arpeggio',
  group: 'Arpeggios and chords',
  name: 'Triad arpeggios',
  about: 'The three notes of a chord played one at a time across the strings, up and down twice.',
  options: [
    keyOption(MAJOR_KEYS, 7),
    {
      id: 'shape',
      label: 'Shape',
      choices: ARPEGGIOS.map((arpeggio) => ({ value: arpeggio.id, label: arpeggio.label })),
      initial: ARPEGGIOS[0].id,
    },
  ],
  make: (values) => {
    const key = Number(values.key)
    const arpeggio = ARPEGGIOS.find((item) => item.id === values.shape) ?? ARPEGGIOS[0]
    const once = upAndDown(arpeggioPlaces(arpeggio, key))
    const name = (arpeggio.minor ? MINOR_KEYS : MAJOR_KEYS)[key]
    return {
      title: `${name} ${arpeggio.minor ? 'minor' : 'major'} arpeggio, root on the ${ordinal(7 - arpeggio.rootString)} string`,
      tempo: 70,
      steps: played([...once, ...once.slice(1)]),
    }
  },
}

const chordChanges: Exercise = {
  id: 'chord-changes',
  group: 'Arpeggios and chords',
  name: 'Chord changes',
  about:
    'Four chords strummed in quarter notes, twice through. Practice mode does not score chords yet, so this one is for playing along.',
  options: [
    {
      id: 'chords',
      label: 'Chords',
      choices: PROGRESSIONS.map((chords, index) => ({ value: String(index), label: chords.join(' – ') })),
      initial: '0',
    },
    {
      id: 'every',
      label: 'Change',
      choices: [
        { value: '4', label: 'Every bar' },
        { value: '2', label: 'Every two beats' },
      ],
      initial: '4',
    },
  ],
  make: (values) => {
    const chords = PROGRESSIONS[Number(values.chords)] ?? PROGRESSIONS[0]
    const strums = Number(values.every) === 2 ? 2 : 4
    const steps: Step[] = []
    for (const name of [...chords, ...chords]) {
      const tones = CHORDS[name].frets.flatMap((fret, index) => (fret < 0 ? [] : [{ string: index + 1, fret }]))
      for (let strum = 0; strum < strums; strum++) {
        steps.push({ tones, length: QUARTER, strum: true, chord: strum === 0 ? name : undefined })
      }
    }
    return {
      title: `Chord changes: ${chords.join(' – ')}${strums === 2 ? ', two beats each' : ''}`,
      tempo: 70,
      steps,
      chords: Object.fromEntries([...new Set(chords)].map((name) => [name, CHORDS[name]])),
    }
  },
}

export const EXERCISES: Exercise[] = [
  ...SCALES.map((scale) => scaleExercise(scale, SCALE_NOTES[scale.id])),
  spider,
  spiderPairs,
  stringSkipping,
  legato,
  shifts,
  arpeggios,
  chordChanges,
]

/** The values an exercise starts with, keyed by option id. */
export function initialValues(exercise: Exercise): Record<string, string> {
  return Object.fromEntries(exercise.options.map((option) => [option.id, option.initial]))
}

export interface BuiltExercise {
  title: string
  /** The same for the same exercise and choices, so it can be found in the library again. */
  fileName: string
  data: Uint8Array
}

/** The chosen values, with missing or unknown ones replaced by the initial ones. */
function resolveValues(exercise: Exercise, chosen: Record<string, string>): Record<string, string> {
  const values = initialValues(exercise)
  for (const option of exercise.options) {
    if (option.choices.some((choice) => choice.value === chosen[option.id])) values[option.id] = chosen[option.id]
  }
  return values
}

/** The file name an exercise is kept under in the library for the given choices. */
export function exerciseFileName(exercise: Exercise, chosen: Record<string, string>): string {
  const values = resolveValues(exercise, chosen)
  const choices = exercise.options.map((option) => values[option.id]).join('-')
  return `exercise-${exercise.id}-${choices}.gp`
}

/** Writes an exercise out as a Guitar Pro file. Choices that are missing or unknown fall back to the initial ones. */
export function buildExercise(exercise: Exercise, chosen: Record<string, string>): BuiltExercise {
  const sheet = exercise.make(resolveValues(exercise, chosen))
  return { title: sheet.title, fileName: exerciseFileName(exercise, chosen), data: buildSheet(sheet) }
}
