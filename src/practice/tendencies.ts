import type { TakeRecord, TimingGroup, TimingTally } from '../library/types'

/** A note of a take, as far as its timing habits go. */
export interface TimedNote {
  /** Where the note is written, the same each time a repeat comes round, to tell one place from another. */
  place: number
  timeMs: number
  /** String and fret of a single note; null for a chord. */
  string: number | null
  fret: number | null
  /** Milliseconds late (positive) or early; null when the note was not played. */
  offsetMs: number | null
}

/** Notes closer together than this count as a fast run, at the tempo played. */
export const FAST_GAP_MS = 180
/** After a longer gap the hand has had time to get there, so the move says nothing. */
const MAX_GAP_MS = 1000
/** Frets the hand must move along a string to count as a shift; less is reachable from one position. */
const SHIFT_FRETS = 5
/** Steady notes on each side a note is measured against, so that slow drift cancels. */
const NEIGHBOURS = 6
/** Steady notes further away than this may be another passage, played differently. */
const MAX_REFERENCE_MS = 4000
/** With notes on one side only, drift would pass for a difference. */
const MIN_EACH_SIDE = 2
/** Fewest notes of a kind in one take for that take to say anything about it. */
const MIN_IN_TAKE = 3
/** Places in the tab kept per kind of note and take. */
const MAX_SPOTS = 12
/** A habit shows in this many separate goes at least, at this many places in the tab. */
const MIN_TAKES = 3
const MIN_SPOTS = 4
const MIN_NOTES = 12
/** Smallest difference worth mentioning, in ms. */
const MIN_EFFECT_MS = 10
/** Share of the takes that must lean the same way. */
const MIN_AGREEMENT = 0.75
/**
 * How clearly separate goes must agree: Student's t for a 2% chance of a
 * false alarm, by degrees of freedom (goes less one).
 */
const CRITICAL_T = [0, 31.82, 6.965, 4.541, 3.747, 3.365, 3.143, 2.998, 2.896, 2.821, 2.764, 2.718, 2.681, 2.65, 2.624, 2.602, 2.583, 2.567, 2.552, 2.539]
/** Smallest distance from the beat worth mentioning, from a measured delay. */
const MIN_BIAS_MS = 15
/** Separate goes looked at for habits. */
const RECENT_SITTINGS = 20

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

type Kind = 'stringChange' | 'shift' | 'fast' | 'baseline'

/** How a note was reached. Each note is of one kind at most, so one cause is not reported as two. */
function kindOf(note: TimedNote, before: TimedNote): Kind | null {
  const gap = note.timeMs - before.timeMs
  if (note.offsetMs === null || before.offsetMs === null || gap > MAX_GAP_MS) return null
  if (note.string === null || before.string === null) return null
  const crossed = note.string !== before.string
  const open = !note.fret || !before.fret
  const shifted = !crossed && !open && Math.abs(note.fret! - before.fret!) >= SHIFT_FRETS
  // Across an open string, how far the hand moved is unknown.
  if (!crossed && open) return null
  if (gap <= FAST_GAP_MS) return crossed || shifted ? null : 'fast'
  if (crossed) return 'stringChange'
  return shifted ? 'shift' : 'baseline'
}

function group(entries: { place: number; value: number }[]): TimingGroup | undefined {
  if (entries.length < MIN_IN_TAKE) return undefined
  return {
    n: entries.length,
    ms: Math.round(median(entries.map((entry) => entry.value)) * 10) / 10,
    spots: [...new Set(entries.map((entry) => entry.place))].slice(0, MAX_SPOTS),
  }
}

/**
 * Sums up how a take's notes sat against each other. Each note that made a
 * move is measured from the steady notes on both sides of it, so an unknown
 * delay between tab and microphone cancels out, and so does tempo drifting
 * through the take. Medians keep one stray note from speaking for its kind.
 * Only `bias`, the distance from the beat itself, needs a measured delay.
 */
export function tallyTiming(notes: TimedNote[], delayMeasured: boolean, sitting = 0): TimingTally | undefined {
  const offsets = notes.flatMap((note) => (note.offsetMs === null ? [] : [note.offsetMs]))
  if (offsets.length === 0) return undefined
  const kinds = notes.map((note, index) => (index > 0 ? kindOf(note, notes[index - 1]) : null))
  const steady = notes.flatMap((note, index) => (kinds[index] === 'baseline' ? [{ index, timeMs: note.timeMs, offset: note.offsetMs! }] : []))
  const tally: TimingTally = { sitting }
  for (const kind of ['stringChange', 'shift', 'fast'] as const) {
    const entries: { place: number; value: number }[] = []
    notes.forEach((note, index) => {
      if (kinds[index] !== kind) return
      const close = steady.filter((item) => Math.abs(item.timeMs - note.timeMs) <= MAX_REFERENCE_MS)
      const before = close.filter((item) => item.index < index).slice(-NEIGHBOURS)
      const after = close.filter((item) => item.index > index).slice(0, NEIGHBOURS)
      if (before.length < MIN_EACH_SIDE || after.length < MIN_EACH_SIDE) return
      entries.push({ place: note.place, value: note.offsetMs! - median([...before, ...after].map((item) => item.offset)) })
    })
    const made = group(entries)
    if (made) tally[kind] = made
  }
  if (delayMeasured) tally.bias = { n: offsets.length, ms: Math.round(median(offsets) * 10) / 10 }
  return tally
}

export type HabitKind = 'stringChange' | 'shift' | 'fast' | 'bias'

export interface TimingHabit {
  kind: HabitKind
  /** Milliseconds: positive is late, negative is early. */
  ms: number
  /** Notes the finding rests on. */
  notes: number
  text: string
  tip: string
}

/**
 * Whether separate goes at the tab agree on something: their mean,
 * or null when they are too few, too small, or differ too much. A go is the
 * unit, as notes next to each other, or passes of one loop, are not
 * independent; takes of one go are first merged into one value.
 */
function agreedMean(items: { sitting: number; value: number; weight: number }[], smallest: number): number | null {
  const merged = new Map<number, { sum: number; weight: number }>()
  for (const item of items) {
    const entry = merged.get(item.sitting) ?? { sum: 0, weight: 0 }
    entry.sum += item.value * item.weight
    entry.weight += item.weight
    merged.set(item.sitting, entry)
  }
  // Every go counts the same, so that one long take cannot outvote the others.
  const values = [...merged.values()].map((entry) => entry.sum / entry.weight)
  const count = values.length
  if (count < MIN_TAKES) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / count
  if (Math.abs(mean) < smallest) return null
  if (values.filter((value) => value * mean > 0).length / count < MIN_AGREEMENT) return null
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1)
  const error = Math.sqrt(variance / count)
  const critical = CRITICAL_T[Math.min(count - 1, CRITICAL_T.length - 1)]
  return error === 0 || Math.abs(mean) / error >= critical ? mean : null
}

/** Tallies of the latest separate goes, so that one long loop does not push the others out. */
function recentTallies(takes: TakeRecord[]): TimingTally[] {
  const sittings = new Set<number>()
  const tallies: TimingTally[] = []
  for (let index = takes.length - 1; index >= 0; index--) {
    const timing = takes[index].timing
    if (!timing) continue
    if (!sittings.has(timing.sitting) && sittings.size === RECENT_SITTINGS) break
    sittings.add(timing.sitting)
    tallies.push(timing)
  }
  return tallies
}

/** Whether any of the latest takes could be read for timing at all. */
export function timingAssessed(takes: TakeRecord[]): boolean {
  return recentTallies(takes).some((timing) => timing.stringChange || timing.shift || timing.fast || timing.bias)
}

const COMPARISONS: { kind: Exclude<HabitKind, 'bias'>; what: string; tip: string }[] = [
  { kind: 'stringChange', what: 'string changes', tip: 'Loop a bar that crosses strings slowly, with the metronome on.' },
  { kind: 'shift', what: 'position shifts', tip: 'Practise the jump on its own: the note before it and the note after it.' },
  { kind: 'fast', what: 'fast runs', tip: 'Drop the tempo until the run feels even, then raise it in small steps.' },
]

const describeMs = (ms: number) => `${Math.abs(Math.round(ms))} ms ${ms < 0 ? 'early' : 'late'}`

/**
 * What stands out in the timing of the latest takes, the clearest first. A
 * kind of note counts as a habit only if several separate goes agree, at
 * several places in the tab.
 * Takes from before timing was kept are skipped.
 */
export function timingHabits(takes: TakeRecord[]): TimingHabit[] {
  const tallies = recentTallies(takes)
  const habits: TimingHabit[] = []
  for (const { kind, what, tip } of COMPARISONS) {
    const found = tallies.flatMap((tally) => {
      const own = tally[kind]
      return own ? [{ own, sitting: tally.sitting }] : []
    })
    const notes = found.reduce((sum, item) => sum + item.own.n, 0)
    if (notes < MIN_NOTES || new Set(found.flatMap((item) => item.own.spots)).size < MIN_SPOTS) continue
    const ms = agreedMean(
      found.map(({ own, sitting }) => ({ sitting, value: own.ms, weight: own.n })),
      MIN_EFFECT_MS,
    )
    if (ms === null) continue
    habits.push({
      kind,
      ms,
      notes,
      text: `You ${ms < 0 ? 'rush' : 'drag'} ${what}: about ${describeMs(ms)} compared with steady notes on one string.`,
      tip,
    })
  }
  habits.sort((a, b) => Math.abs(b.ms) - Math.abs(a.ms))
  const biases = tallies.flatMap((tally) => (tally.bias ? [{ sitting: tally.sitting, value: tally.bias.ms, weight: tally.bias.n }] : []))
  const notes = biases.reduce((sum, bias) => sum + bias.weight, 0)
  const ms = notes >= MIN_NOTES ? agreedMean(biases, MIN_BIAS_MS) : null
  if (ms !== null) {
    habits.push({
      kind: 'bias',
      ms,
      notes,
      text: `Overall you play about ${Math.abs(Math.round(ms))} ms ${ms < 0 ? 'ahead of' : 'behind'} the beat.`,
      tip: ms < 0 ? 'Listen for the click and let it land before you play.' : 'Aim for the front of the click.',
    })
  }
  return habits
}
