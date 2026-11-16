import { describe, expect, it } from 'vitest'
import { synthesize } from './synth'
import {
  type TakeExpectedNote,
  type TakeReport,
  analyzeTake,
  changedNotes,
  describeTake,
  formatTakeAnalysis,
  inputLevel,
} from './takeReport'

const RATE = 48000
const LATENCY_MS = 50
const PITCHES = [45, 52, 57, 60, 64, 62, 59, 55]
const STRINGS = [2, 3, 4, 4, 5, 4, 5, 4]
const TIMES = PITCHES.map((_, i) => 0.3 + i * 0.3)
/** The fifth note (E4) is written but not played. */
const LEFT_OUT = 4

function makeTake(gain = 1) {
  const notes = PITCHES.flatMap((midi, i) => (i === LEFT_OUT ? [] : [{ timeSec: TIMES[i], midi }]))
  const samples = synthesize(notes, RATE, 3.2, { noiseFloor: 0.001 })
  for (let i = 0; i < samples.length; i++) samples[i] *= gain
  const grades: Pick<TakeExpectedNote, 'grade' | 'offsetMs'>[] = PITCHES.map(() => ({ grade: 'onTime', offsetMs: 5 }))
  // As saved: the third note was missed although it was played, the
  // seventh was late, and the left-out one was missed.
  grades[2] = { grade: 'missed', offsetMs: null }
  grades[6] = { grade: 'late', offsetMs: 60 }
  grades[LEFT_OUT] = { grade: 'missed', offsetMs: null }
  const report: TakeReport = {
    savedAt: '2026-11-16T12:00:00.000Z',
    sampleRate: RATE,
    input: { label: 'Test input' },
    speed: 1,
    looping: false,
    passes: 1,
    leeway: 'normal',
    latencyMs: LATENCY_MS,
    latencySource: 'measured',
    expected: PITCHES.map((midi, i) => ({
      pass: 0,
      bar: Math.floor(i / 4),
      tick: i * 480,
      midi: [midi],
      places: [{ string: STRINGS[i], fret: 0 }],
      timeMs: TIMES[i] * 1000 - LATENCY_MS,
      wavSec: TIMES[i],
      ...grades[i],
    })),
    heard: [
      ...TIMES.flatMap((wavSec, i) =>
        i === LEFT_OUT || i === 2 ? [] : [{ wavSec, timeMs: wavSec * 1000, midi: [PITCHES[i]], matched: true }],
      ),
      // Something else heard just after the left-out note.
      { wavSec: TIMES[LEFT_OUT] + 0.04, timeMs: 0, midi: [40], matched: false },
    ],
  }
  return { sampleRate: RATE, samples, report }
}

describe('analyzeTake', () => {
  it('finds the played notes with the current detector and misses the left-out one', () => {
    const analysis = analyzeTake(makeTake())
    const grades = analysis.current.results.map((result) => result.grade)
    expect(grades).toEqual(PITCHES.map((_, i) => (i === LEFT_OUT ? 'missed' : 'onTime')))
    expect(analysis.current.summary.missed).toBe(1)
    expect(analysis.current.heard).toHaveLength(7)
    expect(analysis.latencyFound).toBe('estimated')
    expect(Math.abs(analysis.latencyMs - LATENCY_MS)).toBeLessThan(20)
    expect(analysis.saved.summary.missed).toBe(2)
    expect(analysis.saved.summary.extraNotes).toBe(1)
  })

  it('lists the notes whose grade changed', () => {
    expect(changedNotes(analyzeTake(makeTake()))).toEqual([3, 7])
  })

  it('takes the timing setting from the options over the saved one', () => {
    expect(analyzeTake(makeTake(), { leeway: 'loose' }).leeway).toBe('loose')
    expect(analyzeTake(makeTake()).leeway).toBe('normal')
  })
})

describe('formatTakeAnalysis', () => {
  it('has a row per expected note and names the missed note', () => {
    const text = formatTakeAnalysis(analyzeTake(makeTake()))
    const rows = text.split('\n').filter((line) => /^\s*\d+\s+\d+\s+[A-G]/.test(line))
    expect(rows).toHaveLength(PITCHES.length)
    const missed = rows[LEFT_OUT]
    expect(missed).toContain('E4 s5 f0')
    expect(missed).toContain('MISSED')
    // As saved, a low E was heard 40 ms after it; now nothing is.
    expect(missed).toContain('E2 +40 ms')
    expect(missed).toContain('nothing heard')
    expect(text).toContain('Test input')
    expect(text).toMatch(/Grade differs\s+#3 MISSED -> on time, #7 late -> on time/)
    expect(text).not.toContain('WARNING')
  })

  it('warns about a very quiet input', () => {
    expect(formatTakeAnalysis(analyzeTake(makeTake(0.01)))).toContain('very quiet input')
  })

  it('warns about clipping', () => {
    const take = makeTake()
    take.samples[1000] = 1
    expect(formatTakeAnalysis(analyzeTake(take))).toContain('the input clipped')
  })
})

/** A small hand-built report: four notes on a six-string track, a chord, and what was heard. */
function smallReport(strings?: number): TakeReport {
  const note = (
    wavSec: number,
    midi: number,
    string: number,
    grade: TakeExpectedNote['grade'],
    offsetMs: number | null,
  ): TakeExpectedNote => ({
    pass: 0,
    bar: Math.floor(wavSec),
    tick: 0,
    midi: [midi],
    places: [{ string, fret: 0 }],
    timeMs: wavSec * 1000,
    wavSec,
    grade,
    offsetMs,
  })
  return {
    sampleRate: RATE,
    input: { label: 'Test input' },
    leeway: 'normal',
    latencyMs: 80,
    latencySource: 'measured',
    strings,
    expected: [
      note(0.5, 45, 2, 'onTime', 3),
      note(1.0, 48, 2, 'early', -20),
      // Played as C♯3, 84 ms after it was due.
      note(1.5, 48, 2, 'missed', null),
      // Nothing played at all.
      note(2.0, 57, 4, 'missed', null),
      note(2.5, 52, 3, 'unscored', null),
      note(3.0, 52, 3, 'late', 40),
    ],
    heard: [
      { wavSec: 0.503, timeMs: 0, midi: [45], matched: true },
      { wavSec: 0.98, timeMs: 0, midi: [48], matched: true },
      { wavSec: 1.584, timeMs: 0, midi: [49, 61], matched: false },
      // Too far from the missed note to count as heard instead.
      { wavSec: 2.3, timeMs: 0, midi: [40], matched: false },
      { wavSec: 3.04, timeMs: 0, midi: [52], matched: true },
    ],
  }
}

describe('describeTake', () => {
  const level = { peak: 0.5, rms: 0.1 }

  it('has a row per scored note and leaves the chord out', () => {
    const details = describeTake(smallReport(6), level)
    expect(details.rows.map((row) => row.number)).toEqual([1, 2, 3, 4, 6])
    expect(details.chords).toBe(1)
    expect(details.summary).toMatchObject({ scored: 5, onTime: 1, early: 1, late: 1, missed: 2, extraNotes: 2 })
    expect(details.rows[0]).toMatchObject({ bar: 1, pass: 1, written: 'A2', grade: 'onTime', timing: 'on the beat' })
    expect(details.rows[1].timing).toBe('20 ms early')
    expect(details.rows[4].timing).toBe('40 ms late')
    expect(details.inputLabel).toBe('Test input')
    expect(details.latencyMs).toBe(80)
    expect(details.latencySource).toBe('measured')
    expect(details.looping).toBe(false)
  })

  it('says what was heard instead of a missed note, or that nothing was', () => {
    const rows = describeTake(smallReport(6), level).rows
    expect(rows[2]).toMatchObject({ grade: 'missed', timing: '–', heardInstead: 'C♯3, 84 ms late' })
    expect(rows[3].heardInstead).toBe('nothing heard')
    expect(rows[0].heardInstead).toBe('')
  })

  it('numbers strings from the highest when the string count is known', () => {
    const details = describeTake(smallReport(6), level)
    expect(details.rows[0].place).toBe('string 5, fret 0')
    expect(details.rows[3].place).toBe('string 3, fret 0')
  })

  it('numbers strings from the lowest in an older report without a string count', () => {
    const details = describeTake(smallReport(), level)
    expect(details.rows[0].place).toBe('string 2 from the lowest, fret 0')
    expect(details.byString[0].label).toBe('string 4 from the lowest')
  })

  it('counts misses per string, highest string first', () => {
    expect(describeTake(smallReport(6), level).byString).toEqual([
      { label: 'string 3', missed: 1, total: 1 },
      { label: 'string 4', missed: 0, total: 1 },
      { label: 'string 5', missed: 1, total: 3 },
    ])
  })

  it('gives the level in decibels and warns about clipping or a quiet input', () => {
    const fine = describeTake(smallReport(6), level)
    expect(fine.peakDb).toBeCloseTo(-6.02, 1)
    expect(fine.rmsDb).toBeCloseTo(-20, 1)
    expect(fine.warning).toBeNull()
    expect(describeTake(smallReport(6), { peak: 1, rms: 0.3 }).warning).toBe('clipping')
    const quiet = describeTake(smallReport(6), { peak: 0.01, rms: 0 })
    expect(quiet.warning).toBe('quiet')
    expect(quiet.rmsDb).toBeNull()
  })
})

describe('inputLevel', () => {
  it('finds the peak and RMS level across blocks', () => {
    const level = inputLevel([new Float32Array([0.5, -0.5]), new Float32Array([-0.8, 0])])
    expect(level.peak).toBeCloseTo(0.8)
    expect(level.rms).toBeCloseTo(Math.sqrt((0.25 + 0.25 + 0.64) / 4))
  })

  it('is silent for no audio', () => {
    expect(inputLevel([])).toEqual({ peak: 0, rms: 0 })
  })
})
