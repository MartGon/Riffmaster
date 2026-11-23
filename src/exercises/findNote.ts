export type NoteChoice = 'natural' | 'all'
export type NeckChoice = 'first' | 'twelve' | 'full'

export interface FindNoteSettings {
  notes: NoteChoice
  neck: NeckChoice
  rounds: number
  tuning: string
}

export const NOTE_CHOICES: { id: NoteChoice; name: string; factor: number }[] = [
  { id: 'natural', name: 'Natural notes', factor: 1 },
  { id: 'all', name: 'With sharps and flats', factor: 1.4 },
]

export const NECK_CHOICES: { id: NeckChoice; name: string; lastFret: number; factor: number }[] = [
  { id: 'first', name: 'Frets 1 to 5', lastFret: 5, factor: 1 },
  { id: 'twelve', name: 'Frets 1 to 12', lastFret: 12, factor: 1.3 },
  // 21, as nearly every guitar has at least that many.
  { id: 'full', name: 'Full neck', lastFret: 21, factor: 1.6 },
]

export const ROUND_CHOICES = [10, 20, 30]

/** Open strings, lowest first, as MIDI notes. */
export const GAME_TUNINGS: { id: string; name: string; open: number[]; lastFret?: number }[] = [
  { id: 'standard', name: 'E standard', open: [40, 45, 50, 55, 59, 64] },
  { id: 'eb', name: 'E♭ standard', open: [39, 44, 49, 54, 58, 63] },
  { id: 'dropd', name: 'Drop D', open: [38, 45, 50, 55, 59, 64] },
  { id: 'd', name: 'D standard', open: [38, 43, 48, 53, 57, 62] },
  // Many basses have 20 frets, and a note only at fret 21 could not be played on them.
  { id: 'bass', name: 'Bass, 4 strings', open: [28, 33, 38, 43], lastFret: 20 },
]

export const DEFAULT_SETTINGS: FindNoteSettings = { notes: 'natural', neck: 'twelve', rounds: 10, tuning: 'standard' }

/** How long each note may take, in seconds. */
export const NOTE_LIMIT_SEC = 8
/** Sooner than this after the prompt, a sound was not an answer to it. */
const REACTION_SEC = 0.12
/** A note reported just before time ran out gets this long to arrive. */
const REPORT_SEC = 0.2
/** Early in a round, the note just played can sound again as the hand leaves it. */
const LEAVING_SEC = 0.4
const PITCH_TOLERANCE = 0.6
const pitchMatches = (heard: number[], wanted: number) => heard.some((midi) => Math.abs(midi - wanted) <= PITCH_TOLERANCE)
/** Two attacks this close together are one wrong note, not two. */
const SAME_TRY_SEC = 0.15

const NAMES = ['C', 'C♯ / D♭', 'D', 'D♯ / E♭', 'E', 'F', 'F♯ / G♭', 'G', 'G♯ / A♭', 'A', 'A♯ / B♭', 'B']
const OPEN_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
const NATURAL = new Set([0, 2, 4, 5, 7, 9, 11])

const pitchClass = (midi: number) => ((midi % 12) + 12) % 12

export const noteLabel = (midi: number) => NAMES[pitchClass(midi)]

/** "6th string (low E)", counted the way guitarists do, from the highest. */
export function stringLabel(open: number[], index: number): string {
  const number = open.length - index
  const suffix = number === 1 ? 'st' : number === 2 ? 'nd' : number === 3 ? 'rd' : 'th'
  const name = OPEN_NAMES[pitchClass(open[index])]
  const twin = open.some((midi, other) => other !== index && pitchClass(midi) === pitchClass(open[index]))
  const height = twin ? (index === 0 ? 'low ' : index === open.length - 1 ? 'high ' : '') : ''
  return `${number}${suffix} string (${height}${name})`
}

export interface FindNoteTarget {
  /** Index into the tuning's open strings, lowest first. */
  string: number
  fret: number
  midi: number
}

/** Where on the string to look. Past fret 12 every note comes round again, so the full neck says which. */
export function zoneLabel(target: FindNoteTarget, neck: NeckChoice): string {
  if (neck === 'first') return 'frets 1 to 5'
  if (neck === 'twelve') return 'frets 1 to 12'
  return target.fret > 12 ? 'above the 12th fret' : 'up to the 12th fret'
}

function shuffled<Item>(items: Item[], random: () => number): Item[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Draws the notes of a game. Every place in range comes up once before any
 * comes up again, and no note follows itself: the mic could not tell the
 * answer from the last one still ringing.
 */
export function buildTargets(settings: FindNoteSettings, random: () => number = Math.random): FindNoteTarget[] {
  const tuning = GAME_TUNINGS.find((item) => item.id === settings.tuning) ?? GAME_TUNINGS[0]
  const open = tuning.open
  const neckEnd = (NECK_CHOICES.find((item) => item.id === settings.neck) ?? NECK_CHOICES[1]).lastFret
  const lastFret = Math.min(neckEnd, tuning.lastFret ?? neckEnd)
  const places: FindNoteTarget[] = []
  open.forEach((midi, string) => {
    for (let fret = 1; fret <= lastFret; fret++) {
      if (settings.notes === 'all' || NATURAL.has(pitchClass(midi + fret))) places.push({ string, fret, midi: midi + fret })
    }
  })
  const out: FindNoteTarget[] = []
  let bag: FindNoteTarget[] = []
  while (out.length < settings.rounds) {
    const last = out.at(-1)?.midi
    let at = bag.findIndex((place) => place.midi !== last)
    if (at < 0) {
      bag = [...bag, ...shuffled(places, random)]
      at = bag.findIndex((place) => place.midi !== last)
    }
    out.push(bag.splice(at, 1)[0])
  }
  return out
}

export function difficultyFactor(settings: Pick<FindNoteSettings, 'notes' | 'neck'>): number {
  const notes = NOTE_CHOICES.find((item) => item.id === settings.notes)?.factor ?? 1
  const neck = NECK_CHOICES.find((item) => item.id === settings.neck)?.factor ?? 1
  return notes * neck
}

/** Full marks up to a second, then falling to a fifth at the time limit. */
export function speedShare(seconds: number): number {
  if (seconds <= 1) return 1
  return Math.max(0.2, 1 - (0.8 * (seconds - 1)) / (NOTE_LIMIT_SEC - 1))
}

/** Clean notes in a row add 10% each, up to 50%. */
const streakFactor = (streak: number) => 1 + 0.1 * Math.min(streak, 5)

export function notePoints(seconds: number, wrong: number, streak: number, factor: number): number {
  const accuracy = Math.max(0.25, 1 - 0.25 * wrong)
  return Math.round(100 * speedShare(seconds) * accuracy * streakFactor(streak) * factor)
}

export interface RoundResult {
  target: FindNoteTarget
  found: boolean
  /** From the prompt to the note, in seconds; null when it was not found. */
  seconds: number | null
  wrong: number
  points: number
}

export interface GameSummary {
  score: number
  /** The score of a game with every note clean and within a second. */
  perfect: number
  grade: 'S' | 'A' | 'B' | 'C' | 'D'
  found: number
  clean: number
  total: number
  /** Share of notes found with no wrong note first, from 0 to 1. */
  accuracy: number
  averageSec: number | null
  /** The notes to look at again, the most troubled first. */
  worst: RoundResult[]
}

export function summarize(results: RoundResult[], factor: number): GameSummary {
  const score = results.reduce((sum, result) => sum + result.points, 0)
  const perfect = results.reduce((sum, _, index) => sum + notePoints(0, 0, index, factor), 0)
  const share = perfect > 0 ? score / perfect : 0
  const grade = share >= 0.85 ? 'S' : share >= 0.7 ? 'A' : share >= 0.5 ? 'B' : share >= 0.3 ? 'C' : 'D'
  const found = results.filter((result) => result.found)
  const clean = found.filter((result) => result.wrong === 0).length
  const averageSec = found.length > 0 ? found.reduce((sum, result) => sum + (result.seconds ?? 0), 0) / found.length : null
  const worst = results
    .filter((result) => !result.found || result.wrong > 0 || (result.seconds ?? 0) > 3)
    .sort((a, b) => Number(a.found) - Number(b.found) || b.wrong - a.wrong || (b.seconds ?? 0) - (a.seconds ?? 0))
    .slice(0, 3)
  return { score, perfect, grade, found: found.length, clean, total: results.length, accuracy: results.length > 0 ? clean / results.length : 0, averageSec, worst }
}

/** A note as the detector reports it. */
export interface GameNote {
  timeSec: number
  midi: number[]
  legato?: boolean
}

/**
 * The rules of one game, on the clock of the audio. Knows nothing of the
 * microphone or the screen. A microphone cannot tell strings apart, so the
 * same pitch on another string also counts.
 */
export class FindNoteGame {
  readonly targets: FindNoteTarget[]
  readonly results: RoundResult[] = []
  private readonly factor: number
  private askedAt: number | null = null
  private lastTry = Number.NEGATIVE_INFINITY
  streak = 0
  wrong = 0
  /** The pitch last heard instead of the note asked for. */
  heardWrong: number | null = null

  constructor(targets: FindNoteTarget[], factor: number) {
    this.targets = targets
    this.factor = factor
  }

  get index(): number {
    return this.results.length
  }

  get finished(): boolean {
    return this.results.length >= this.targets.length
  }

  get current(): FindNoteTarget | null {
    return this.targets[this.index] ?? null
  }

  get score(): number {
    return this.results.reduce((sum, result) => sum + result.points, 0)
  }

  /** Puts the next note to the player, as of this moment in the audio. */
  ask(atSec: number): void {
    this.askedAt = atSec
    this.wrong = 0
    this.heardWrong = null
    this.lastTry = Number.NEGATIVE_INFINITY
  }

  /** Takes in a note. Returns the round's result if this note ended it. */
  hear(note: GameNote): RoundResult | null {
    const target = this.current
    if (!target || this.askedAt === null || note.legato) return null
    const seconds = note.timeSec - this.askedAt
    if (seconds < REACTION_SEC || seconds > NOTE_LIMIT_SEC) return null
    // Only the likeliest reading earns the note: the others are often the octave of what was played.
    if (note.midi.length > 0 && pitchMatches([note.midi[0]], target.midi)) {
      const points = notePoints(seconds, this.wrong, this.streak, this.factor)
      this.streak = this.wrong === 0 ? this.streak + 1 : 0
      return this.finish({ target, found: true, seconds, wrong: this.wrong, points })
    }
    // Perhaps the right note, read an octave out: neither credit nor blame.
    if (pitchMatches(note.midi, target.midi)) return null
    const previous = this.results.at(-1)?.target.midi
    if (seconds < LEAVING_SEC && previous !== undefined && pitchMatches(note.midi, previous)) return null
    const sameTry = note.timeSec - this.lastTry < SAME_TRY_SEC
    this.lastTry = note.timeSec
    if (!sameTry) this.wrong++
    this.heardWrong = note.midi[0] ?? null
    return null
  }

  /** Ends the round if its time has run out. */
  expire(nowSec: number): RoundResult | null {
    const target = this.current
    if (!target || this.askedAt === null || nowSec - this.askedAt < NOTE_LIMIT_SEC + REPORT_SEC) return null
    this.streak = 0
    return this.finish({ target, found: false, seconds: null, wrong: this.wrong, points: 0 })
  }

  /** How much of the round's time is left, from 1 to 0. */
  timeLeft(nowSec: number): number {
    if (this.askedAt === null) return 1
    return Math.max(0, 1 - (nowSec - this.askedAt) / NOTE_LIMIT_SEC)
  }

  summary(): GameSummary {
    return summarize(this.results, this.factor)
  }

  private finish(result: RoundResult): RoundResult {
    this.results.push(result)
    this.askedAt = null
    return result
  }
}

const KEY = 'riffmaster.findNote'

export interface FindNoteStore {
  settings: FindNoteSettings
  best: Record<string, number>
}

export const bestKey = (settings: FindNoteSettings) => `${settings.notes}-${settings.neck}-${settings.rounds}`

export function loadFindNote(): FindNoteStore {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<FindNoteStore> | null
    const saved: Partial<FindNoteSettings> = stored?.settings ?? {}
    const best: Record<string, number> = {}
    for (const [key, value] of Object.entries(stored?.best ?? {})) if (Number.isFinite(value) && value >= 0) best[key] = value
    return {
      settings: {
        notes: NOTE_CHOICES.some((item) => item.id === saved.notes) ? saved.notes! : DEFAULT_SETTINGS.notes,
        neck: NECK_CHOICES.some((item) => item.id === saved.neck) ? saved.neck! : DEFAULT_SETTINGS.neck,
        rounds: ROUND_CHOICES.includes(saved.rounds ?? -1) ? saved.rounds! : DEFAULT_SETTINGS.rounds,
        tuning: GAME_TUNINGS.some((item) => item.id === saved.tuning) ? saved.tuning! : DEFAULT_SETTINGS.tuning,
      },
      best,
    }
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, best: {} }
  }
}

/** The higher score of each, so another tab's better score is not written over. */
export function mergeBest(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a }
  for (const [key, value] of Object.entries(b)) out[key] = Math.max(out[key] ?? 0, value)
  return out
}

export function saveFindNote(store: FindNoteStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // Without storage the scores last for this visit only.
  }
}
