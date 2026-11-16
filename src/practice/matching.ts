/** A note the tab expects, at a time on the song's own clock. */
export interface ExpectedNote {
  /** Time in milliseconds from the start of the song, at the current playback speed. */
  timeMs: number
  /** MIDI pitches sounding together on this beat. */
  midi: number[]
}

/** A note heard through the microphone, on the same clock but before latency correction. */
export interface PlayedNote {
  timeMs: number
  /**
   * MIDI pitches the note could be, the most likely first. Usually one; a
   * second appears when the detector could not tell the octave apart.
   */
  midi: number[]
}

export type NoteGrade = 'onTime' | 'early' | 'late' | 'missed' | 'unscored'

export interface NoteResult {
  grade: NoteGrade
  /** Milliseconds late (positive) or early (negative); null unless the note was matched. */
  offsetMs: number | null
}

export interface MatchOptions {
  /** How far, in semitones, a played pitch may be from the written one. */
  pitchTolerance: number
  /** Notes further than this from their expected time do not count as played. */
  windowMs: number
  /** Notes closer than this to their expected time count as on time. */
  onTimeMs: number
}

export const defaultMatchOptions: MatchOptions = {
  pitchTolerance: 0.6,
  windowMs: 150,
  onTimeMs: 50,
}

/** How strictly timing is judged in practice. */
export type TimingLeeway = 'strict' | 'normal' | 'relaxed' | 'loose'

export const TIMING_LEEWAYS: { id: TimingLeeway; label: string; onTimeMs: number; windowMs: number }[] = [
  { id: 'strict', label: 'Strict (±30 ms)', onTimeMs: 30, windowMs: 120 },
  { id: 'normal', label: 'Normal (±50 ms)', onTimeMs: 50, windowMs: 150 },
  { id: 'relaxed', label: 'Relaxed (±80 ms)', onTimeMs: 80, windowMs: 200 },
  { id: 'loose', label: 'Loose (±120 ms)', onTimeMs: 120, windowMs: 260 },
]

/**
 * Matching options for a leeway. A note within `onTimeMs` of the beat is on
 * time; one within `windowMs` counts as played, early or late; further away
 * it counts as missed.
 */
export function matchOptionsFor(leeway: TimingLeeway): MatchOptions {
  const preset = TIMING_LEEWAYS.find((item) => item.id === leeway) ?? TIMING_LEEWAYS[1]
  return { ...defaultMatchOptions, onTimeMs: preset.onTimeMs, windowMs: preset.windowMs }
}

/** Only single notes are scored; chords need a different kind of detection. */
export function isScored(note: ExpectedNote): boolean {
  return note.midi.length === 1
}

/** Whether any of the pitches a played note could be is the written one. */
export function pitchMatches(played: number[], written: number, tolerance: number): boolean {
  return played.some((midi) => Math.abs(midi - written) <= tolerance)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export interface LatencyEstimate {
  latencyMs: number
  /** How many played notes agreed with this estimate. */
  support: number
}

/**
 * Finds the delay between the tab and what the microphone heard, from the
 * playing itself. Every pairing of a played note with a same-pitch expected
 * note votes for the delay that would line them up; the true delay collects
 * votes from all correctly played notes, while wrong pairings scatter.
 */
export function estimateLatency(
  expected: ExpectedNote[],
  played: PlayedNote[],
  options: {
    minMs?: number
    maxMs?: number
    pitchTolerance?: number
    /**
     * A delay known from before (measured, or learned from the last take).
     * Used only to choose between candidates that fit equally well, which
     * happens on lines that repeat one pitch at a steady rate: there the
     * true delay and the delay one note earlier or later look the same.
     */
    preferMs?: number
  } = {},
): LatencyEstimate | null {
  const minMs = options.minMs ?? -150
  const maxMs = options.maxMs ?? 800
  const tolerance = options.pitchTolerance ?? defaultMatchOptions.pitchTolerance
  const binMs = 10
  const bins = new Array<number>(Math.ceil((maxMs - minMs) / binMs) + 1).fill(0)
  const votes: number[] = []

  const scored = expected.filter(isScored)
  let first = 0
  for (const note of played) {
    while (first < scored.length && scored[first].timeMs < note.timeMs - maxMs) first++
    for (let i = first; i < scored.length; i++) {
      const delay = note.timeMs - scored[i].timeMs
      if (delay < minMs) break
      if (!pitchMatches(note.midi, scored[i].midi[0], tolerance)) continue
      votes.push(delay)
      bins[Math.floor((delay - minMs) / binMs)]++
    }
  }
  if (votes.length < 3) return null

  // Find the densest 30 ms stretch, then take the median of the votes around it.
  const density = bins.map((count, i) => (bins[i - 1] ?? 0) + count + (bins[i + 1] ?? 0))
  const bestCount = Math.max(...density)
  // With a delay known from before, stretches within a vote or so of the
  // best are treated as equally plausible and the one nearest that delay
  // wins. Without one, the most votes win, and an exact tie goes to the
  // smallest delay that is not negative, since sound cannot arrive early.
  const slack = options.preferMs === undefined ? 0 : Math.max(1, Math.round(bestCount * 0.05))
  const centreOf = (i: number) => minMs + (i + 0.5) * binMs
  const rank = (i: number) => {
    const ms = centreOf(i)
    if (options.preferMs !== undefined) return Math.abs(ms - options.preferMs)
    return ms >= -binMs ? ms : 10_000 - ms
  }
  let best = -1
  for (let i = 0; i < density.length; i++) {
    if (density[i] < bestCount - slack) continue
    if (best < 0 || rank(i) < rank(best) || (rank(i) === rank(best) && density[i] > density[best])) {
      best = i
    }
  }
  // Settle on the fullest bin of that stretch.
  while (density[best + 1] > density[best]) best++
  while (density[best - 1] > density[best]) best--
  const centre = centreOf(best)
  const near = votes.filter((delay) => Math.abs(delay - centre) <= 40)
  if (near.length < 3) return null
  return { latencyMs: median(near), support: near.length }
}

/**
 * Pairs each expected note with the played note that best fits it, after
 * shifting the played notes by the latency. Closest pairs are matched first
 * and every played note is used at most once.
 */
export function matchNotes(
  expected: ExpectedNote[],
  played: PlayedNote[],
  latencyMs: number,
  options: MatchOptions = defaultMatchOptions,
): { results: NoteResult[]; extraNotes: number; usedPlayed: Set<number> } {
  const results: NoteResult[] = expected.map((note) => ({
    grade: isScored(note) ? 'missed' : 'unscored',
    offsetMs: null,
  }))
  const pairs: { e: number; p: number; offset: number }[] = []
  let first = 0
  for (let e = 0; e < expected.length; e++) {
    const note = expected[e]
    const target = note.timeMs + latencyMs
    while (first < played.length && played[first].timeMs < target - options.windowMs) first++
    for (let p = first; p < played.length; p++) {
      const offset = played[p].timeMs - target
      if (offset > options.windowMs) break
      // A chord is heard as one attack carrying one of its notes.
      if (note.midi.some((midi) => pitchMatches(played[p].midi, midi, options.pitchTolerance))) {
        pairs.push({ e, p, offset })
      }
    }
  }
  pairs.sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset))
  const usedPlayed = new Set<number>()
  const chordHeard = new Set<number>()
  for (const { e, p, offset } of pairs) {
    if (usedPlayed.has(p)) continue
    if (!isScored(expected[e])) {
      // Chords are not graded, but the attack they produced is set aside so
      // it cannot count as a nearby single note that was never played.
      if (!chordHeard.has(e)) {
        chordHeard.add(e)
        usedPlayed.add(p)
      }
      continue
    }
    if (results[e].offsetMs !== null) continue
    usedPlayed.add(p)
    results[e] = {
      grade: Math.abs(offset) <= options.onTimeMs ? 'onTime' : offset < 0 ? 'early' : 'late',
      offsetMs: offset,
    }
  }
  return { results, extraNotes: played.length - usedPlayed.size, usedPlayed }
}

export interface PracticeSummary {
  /** Notes that were scored (single notes inside the played section). */
  scored: number
  hit: number
  onTime: number
  early: number
  late: number
  missed: number
  /** Chord beats that were left out of the score. */
  unscored: number
  /** Played notes that matched nothing in the tab. */
  extraNotes: number
  /** Share of scored notes that were played, from 0 to 1. */
  accuracy: number
  /** Typical distance from the beat in milliseconds, among played notes. */
  typicalOffsetMs: number | null
  /** Median offset: positive means the playing sits behind the beat. Only meaningful with a measured latency. */
  biasMs: number | null
}

export function summarize(results: NoteResult[], extraNotes: number): PracticeSummary {
  const count = (grade: NoteGrade) => results.filter((r) => r.grade === grade).length
  const onTime = count('onTime')
  const early = count('early')
  const late = count('late')
  const missed = count('missed')
  const hit = onTime + early + late
  const scored = hit + missed
  const offsets = results.flatMap((r) => (r.offsetMs === null ? [] : [r.offsetMs]))
  return {
    scored,
    hit,
    onTime,
    early,
    late,
    missed,
    unscored: count('unscored'),
    extraNotes,
    accuracy: scored > 0 ? hit / scored : 0,
    typicalOffsetMs: offsets.length > 0 ? median(offsets.map(Math.abs)) : null,
    biasMs: offsets.length > 0 ? median(offsets) : null,
  }
}
