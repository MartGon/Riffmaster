import { describe, expect, it } from 'vitest'
import { synthesize } from './synth'
import { type TakeExpectedNote, type TakeReport, analyzeTake, changedNotes, formatTakeAnalysis } from './takeReport'

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
