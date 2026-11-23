import { describe, expect, it } from 'vitest'
import {
  estimateLatency,
  matchOptionsFor,
  type TimingLeeway,
  type ExpectedNote,
  matchAfterRunUp, matchNotes,
  type PlayedNote,
  pitchMatches,
  summarize,
  chordHeard,
} from './matching'

/** A scale run of eighth notes at 120 bpm (250 ms apart). */
function line(count: number, gapMs = 250): ExpectedNote[] {
  const pitches = [52, 55, 57, 59, 60, 59, 57, 55]
  return Array.from({ length: count }, (_, i) => ({
    timeMs: 1000 + i * gapMs,
    midi: [pitches[i % pitches.length]],
  }))
}

/** Plays the expected notes back with a device delay and per-note timing errors. */
function perform(
  expected: ExpectedNote[],
  delayMs: number,
  errorMs: (index: number) => number = () => 0,
): PlayedNote[] {
  return expected.map((note, i) => ({ timeMs: note.timeMs + delayMs + errorMs(i), midi: [note.midi[0]] }))
}

const jitter = (i: number) => ((i * 37) % 21) - 10 // deterministic, within ±10 ms

describe('pitchMatches', () => {
  it('accepts the written pitch within the tolerance', () => {
    expect(pitchMatches([52.4], 52, 0.6)).toBe(true)
    expect(pitchMatches([53], 52, 0.6)).toBe(false)
    expect(pitchMatches([64], 52, 0.6)).toBe(false)
  })

  it('accepts any of the pitches the detector offered', () => {
    expect(pitchMatches([64, 52], 52, 0.6)).toBe(true)
    expect(pitchMatches([], 52, 0.6)).toBe(false)
  })
})

describe('estimateLatency', () => {
  it('recovers a short wired delay', () => {
    const expected = line(24)
    const estimate = estimateLatency(expected, perform(expected, 35, jitter))
    expect(estimate?.latencyMs).toBeGreaterThan(25)
    expect(estimate?.latencyMs).toBeLessThan(45)
  })

  it('recovers a long Bluetooth delay, longer than the gap between notes', () => {
    const expected = line(32, 125) // sixteenth notes at 120 bpm
    const estimate = estimateLatency(expected, perform(expected, 280, jitter))
    expect(estimate?.latencyMs).toBeGreaterThan(270)
    expect(estimate?.latencyMs).toBeLessThan(290)
  })

  it('is not thrown off by one badly timed first note', () => {
    const expected = line(16)
    const played = perform(expected, 200, (i) => (i === 0 ? 90 : jitter(i)))
    const estimate = estimateLatency(expected, played)
    expect(Math.abs((estimate?.latencyMs ?? 0) - 200)).toBeLessThan(10)
  })

  it('ignores wrong and missing notes', () => {
    const expected = line(24)
    const played = perform(expected, 120, jitter)
      .filter((_, i) => i % 6 !== 0)
      .map((note, i) => (i % 5 === 0 ? { ...note, midi: [note.midi[0] + 3] } : note))
    const estimate = estimateLatency(expected, played)
    expect(Math.abs((estimate?.latencyMs ?? 0) - 120)).toBeLessThan(10)
  })

  it('uses a known delay to settle a line that repeats one pitch', () => {
    // Steady eighth notes on one pitch: the delay could equally be one note off.
    const expected: ExpectedNote[] = Array.from({ length: 16 }, (_, i) => ({
      timeMs: 1000 + i * 312.5,
      midi: [45],
    }))
    const played = perform(expected, 250).slice(0, -1)
    expect(Math.abs((estimateLatency(expected, played)?.latencyMs ?? 0) - 250)).toBeLessThan(10)
    const withMemory = estimateLatency(expected, played, { preferMs: 240 })
    expect(Math.abs((withMemory?.latencyMs ?? 0) - 250)).toBeLessThan(10)
  })

  it('prefers a delay that is not negative when candidates fit equally', () => {
    const expected: ExpectedNote[] = Array.from({ length: 24 }, (_, i) => ({
      timeMs: 1000 + i * 156.25,
      midi: [45],
    }))
    for (const delay of [60, 100]) {
      const estimate = estimateLatency(expected, perform(expected, delay).slice(0, -1))
      expect(Math.abs((estimate?.latencyMs ?? 0) - delay), `delay ${delay}`).toBeLessThan(10)
    }
  })

  it('gives no estimate from too little playing', () => {
    const expected = line(8)
    expect(estimateLatency(expected, perform(expected, 100).slice(0, 2))).toBeNull()
    expect(estimateLatency(expected, [])).toBeNull()
  })
})

describe('matchNotes', () => {
  it('grades a clean performance as all on time', () => {
    const expected = line(16)
    const { results, extraNotes } = matchNotes(expected, perform(expected, 150, jitter), 150)
    expect(results.every((r) => r.grade === 'onTime')).toBe(true)
    expect(extraNotes).toBe(0)
  })

  it('reports missed, wrong, early and late notes', () => {
    const expected = line(10)
    const played = perform(expected, 100, (i) => (i === 3 ? -90 : i === 6 ? 110 : 0))
      .map((note, i) => (i === 1 ? { ...note, midi: [note.midi[0] + 2] } : note)) // wrong pitch
      .filter((_, i) => i !== 8) // not played
    const { results, extraNotes } = matchNotes(expected, played, 100)
    expect(results.map((r) => r.grade)).toEqual([
      'onTime', 'missed', 'onTime', 'early', 'onTime', 'onTime', 'late', 'onTime', 'missed', 'onTime',
    ])
    expect(results[3].offsetMs).toBeCloseTo(-90)
    expect(results[6].offsetMs).toBeCloseTo(110)
    expect(extraNotes).toBe(1) // the wrong note
  })

  it('matches repeated notes one to one', () => {
    const expected: ExpectedNote[] = [0, 1, 2, 3].map((i) => ({ timeMs: 1000 + i * 200, midi: [52] }))
    const played = perform(expected, 0).filter((_, i) => i !== 1)
    const { results } = matchNotes(expected, played, 0)
    expect(results.map((r) => r.grade)).toEqual(['onTime', 'missed', 'onTime', 'onTime'])
  })

  it('does not let a chord played wrong count as a nearby single note that was not played', () => {
    const expected: ExpectedNote[] = [
      { timeMs: 1000, midi: [40, 47, 52] },
      { timeMs: 1100, midi: [40] },
    ]
    // Only a wrong chord is played: one attack on its root, without the fifth.
    const { results, extraNotes } = matchNotes(expected, [{ timeMs: 1000, midi: [40], present: [40, 52] }], 0)
    expect(results.map((r) => r.grade)).toEqual(['missed', 'missed'])
    expect(extraNotes).toBe(0)
  })

  it('still credits a single note played right after a chord', () => {
    const expected: ExpectedNote[] = [
      { timeMs: 1000, midi: [40, 47, 52] },
      { timeMs: 1100, midi: [40] },
    ]
    const played = [
      { timeMs: 1005, midi: [40], present: [40, 47, 52, 59] },
      { timeMs: 1090, midi: [40] },
    ]
    const { results } = matchNotes(expected, played, 0)
    expect(results.map((r) => r.grade)).toEqual(['onTime', 'onTime'])
  })

  it('scores a chord by whether all of it sounds, and its timing', () => {
    const expected: ExpectedNote[] = [
      { timeMs: 1000, midi: [52] },
      { timeMs: 1500, midi: [48, 52, 55, 60, 64] }, // C major, open
      { timeMs: 2000, midi: [48, 52, 55, 60, 64] },
      { timeMs: 2500, midi: [48, 52, 55, 60, 64] },
    ]
    const played: PlayedNote[] = [
      { timeMs: 1000, midi: [52] },
      // Heard on time, with every note.
      { timeMs: 1510, midi: [60], present: [48, 52, 55, 60, 64, 67] },
      // 90 ms late, the high E string muted: still C major.
      { timeMs: 2090, midi: [60], present: [48, 52, 55, 60] },
      // A minor instead (A, C, E): no G, so not C major.
      { timeMs: 2500, midi: [57], present: [45, 52, 57, 60, 64] },
    ]
    const { results } = matchNotes(expected, played, 0)
    expect(results.map((r) => r.grade)).toEqual(['onTime', 'onTime', 'late', 'missed'])
  })

  it('counts a chord with no sound heard after its attack as missed', () => {
    const { results } = matchNotes([{ timeMs: 1000, midi: [52, 59, 64] }], [{ timeMs: 1000, midi: [52] }], 0)
    expect(results.map((r) => r.grade)).toEqual(['missed'])
  })
})

describe('chordHeard', () => {
  it('needs every pitch class, at an octave the tab writes it in', () => {
    const g = [43, 47, 50, 55, 59, 67] // G major, open: G B D G B G
    expect(chordHeard(g, [43, 47, 50, 55, 59, 67])).toBe(true)
    // A doubled note left out does not matter.
    expect(chordHeard(g, [43, 47, 50])).toBe(true)
    // Without any D it is not G major.
    expect(chordHeard(g, [43, 47, 55, 59, 67])).toBe(false)
    // A D at an octave the tab does not have (an overtone) does not count.
    expect(chordHeard(g, [43, 47, 55, 59, 62, 67])).toBe(false)
    expect(chordHeard(g, undefined)).toBe(false)
  })
})

describe('summarize', () => {
  it('counts grades and computes accuracy over scored notes', () => {
    const expected: ExpectedNote[] = [
      ...line(4),
      { timeMs: 3000, midi: [40, 47] },
    ]
    const played = perform(line(4), 0, (i) => (i === 1 ? 80 : 0)).filter((_, i) => i !== 2)
    const { results, extraNotes } = matchNotes(expected, played, 0)
    const summary = summarize(results, extraNotes)
    expect(summary).toMatchObject({
      scored: 5, hit: 3, onTime: 2, late: 1, early: 0, missed: 2, unscored: 0, extraNotes: 0,
    })
    expect(summary.accuracy).toBeCloseTo(0.6)
    expect(summary.typicalOffsetMs).toBe(0)
  })

  it('handles a take with nothing to score', () => {
    expect(summarize([], 0)).toMatchObject({ scored: 0, accuracy: 0, typicalOffsetMs: null })
  })
})

describe('timing leeway', () => {
  it('judges the same playing more or less strictly', () => {
    const expected = [{ timeMs: 1000, midi: [60] }, { timeMs: 2000, midi: [62] }, { timeMs: 3000, midi: [64] }]
    // 40 ms late, 100 ms early, 180 ms late.
    const played = [{ timeMs: 1040, midi: [60] }, { timeMs: 1900, midi: [62] }, { timeMs: 3180, midi: [64] }]
    const grades = (leeway: TimingLeeway) =>
      matchNotes(expected, played, 0, matchOptionsFor(leeway)).results.map((r) => r.grade)
    expect(grades('strict')).toEqual(['late', 'early', 'missed'])
    expect(grades('normal')).toEqual(['onTime', 'early', 'missed'])
    expect(grades('relaxed')).toEqual(['onTime', 'early', 'late'])
    expect(grades('loose')).toEqual(['onTime', 'onTime', 'late'])
  })
})

describe('a run-up before the scored notes', () => {
  const options = { pitchTolerance: 0.6, windowMs: 200, onTimeMs: 80 }

  it('keeps a run-up note from passing for a missed scored note', () => {
    const runUp = [{ timeMs: 844, midi: [60] }]
    const scored = [{ timeMs: 1000, midi: [60] }, { timeMs: 1500, midi: [62] }]
    const played = [{ timeMs: 844, midi: [60] }, { timeMs: 1500, midi: [62] }]
    const { results, extraNotes } = matchAfterRunUp(scored, runUp, played, 0, options)
    expect(results.map((result) => result.grade)).toEqual(['missed', 'onTime'])
    expect(extraNotes).toBe(0)
  })

  it('does not count a wrong note in the run-up as an extra note', () => {
    const runUp = [{ timeMs: 200, midi: [55] }]
    const scored = [{ timeMs: 1000, midi: [60] }]
    const played = [{ timeMs: 200, midi: [57] }, { timeMs: 1000, midi: [60] }]
    const { results, extraNotes } = matchAfterRunUp(scored, runUp, played, 0, options)
    expect(results.map((result) => result.grade)).toEqual(['onTime'])
    expect(extraNotes).toBe(0)
  })

  it('does not count a wrong last run-up note just before the first scored note', () => {
    const runUp = [{ timeMs: 870, midi: [55] }]
    const scored = [{ timeMs: 1000, midi: [60] }]
    const played = [{ timeMs: 870, midi: [57] }, { timeMs: 1000, midi: [60] }]
    expect(matchAfterRunUp(scored, runUp, played, 0, { ...options, windowMs: 150 }).extraNotes).toBe(0)
  })

  it('lets the next pass keep its first run-up note at the turn of a loop', () => {
    const scored = [{ timeMs: 900, midi: [60] }, { timeMs: 1000, midi: [64] }]
    const runUp = [{ timeMs: 1130, midi: [64] }]
    const played = [{ timeMs: 900, midi: [60] }, { timeMs: 1130, midi: [64] }]
    const { results } = matchAfterRunUp(scored, runUp, played, 0, { ...options, windowMs: 260 })
    expect(results.map((result) => result.grade)).toEqual(['onTime', 'missed'])
  })

  it('still counts a wrong note among the scored notes', () => {
    const runUp = [{ timeMs: 200, midi: [55] }]
    const scored = [{ timeMs: 1000, midi: [60] }]
    const played = [{ timeMs: 1000, midi: [60] }, { timeMs: 1100, midi: [70] }]
    expect(matchAfterRunUp(scored, runUp, played, 0, options).extraNotes).toBe(1)
  })
})
