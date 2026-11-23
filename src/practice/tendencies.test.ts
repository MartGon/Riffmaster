import { describe, expect, it } from 'vitest'
import type { TakeRecord, TimingTally } from '../library/types'
import { estimateLatency } from './matching'
import { tallyTiming, timingAssessed, timingHabits, type TimedNote } from './tendencies'

type Place = [string: number, fret: number]

/** Notes 250 ms apart with a little scatter; `late` says how far each is from the beat. */
function line(count: number, place: (i: number) => Place, late: (i: number) => number, gap = 250, seed = 0): TimedNote[] {
  return Array.from({ length: count }, (_, i) => {
    const [string, fret] = place(i)
    return { place: i * 240, timeMs: i * gap, string, fret, offsetMs: late(i) + (((i + seed) * 7) % 5) - 2 }
  })
}
let id = 0
const take = (timing: TimingTally | undefined): TakeRecord => ({
  id: String(id++), songId: 's', at: id, trackIndex: 0, speed: 1, startBar: 0, endBar: 1, scored: 8, onTime: 8, early: 0, late: 0, missed: 0, accuracy: 1, bars: {}, trainer: false, timing,
})
const takes = (make: (seed: number) => TimedNote[], count = 3, measured = false) =>
  Array.from({ length: count }, (_, seed) => take(tallyTiming(make(seed), measured, seed + 1)))
/** Two notes on a string, then two on the next: every other note is a string change. */
const crossing = (i: number): Place => [i % 4 < 2 ? 1 : 2, 5]
const crossed = (i: number) => i % 2 === 0

describe('timing habits', () => {
  it('finds string changes that come late, over several takes', () => {
    const [habit] = timingHabits(takes((seed) => line(60, crossing, (i) => (crossed(i) ? 30 : 0), 250, seed)))
    expect(habit.kind).toBe('stringChange')
    expect(habit.ms).toBeGreaterThan(20)
    expect(habit.text).toContain('drag string changes')
  })

  it('finds string changes that come early', () => {
    const [habit] = timingHabits(takes((seed) => line(60, crossing, (i) => (crossed(i) ? -30 : 0), 250, seed)))
    expect(habit.text).toContain('rush string changes')
  })

  it('does not call one take a habit', () => {
    expect(timingHabits(takes((seed) => line(60, crossing, (i) => (crossed(i) ? 30 : 0), 250, seed), 2))).toEqual([])
  })

  it('does not depend on the delay between tab and microphone', () => {
    const size = (shift: number) =>
      timingHabits(takes((seed) => line(60, crossing, (i) => (crossed(i) ? 30 : 0) + shift, 250, seed)))[0].ms
    expect(size(120)).toBeCloseTo(size(0), 5)
  })

  it('does not take a slow drift through the take for a habit', () => {
    // Steady notes first, string changes in the second half, the whole take drifting later.
    const place = (i: number): Place => (i < 40 ? [1, 5] : crossing(i))
    expect(timingHabits(takes((seed) => line(80, place, (i) => i * 0.75, 250, seed)))).toEqual([])
  })

  it('compares within each take, so a different mix of notes in each does not matter', () => {
    const late = (i: number) => (crossed(i) ? 30 : 0)
    const make = (seed: number) => line(60, crossing, (i) => late(i) + (seed === 1 ? 60 : 0), 250, seed)
    expect(timingHabits(takes(make))[0].ms).toBeGreaterThan(20)
  })

  it('does not report a late shift as rushed string changes as well', () => {
    const place = (i: number): Place => (i % 8 < 4 ? [1, i % 2 ? 3 : 4] : i % 8 < 6 ? [1, 10] : [2, 10])
    const shifted = (i: number) => i % 8 === 4
    const habits = timingHabits(takes((seed) => line(96, place, (i) => (shifted(i) ? 40 : 0), 250, seed)))
    expect(habits.some((habit) => habit.kind === 'stringChange' && habit.ms < 0)).toBe(false)
  })

  it('does not call fretting inside one position a shift', () => {
    // A jump of three frets inside a box, late every time.
    const box = (i: number): Place => [1, i % 4 === 2 ? 8 : 5]
    const tally = tallyTiming(line(40, box, (i) => (i % 4 === 2 ? 30 : 0)), false)!
    expect(tally.shift).toBeUndefined()
  })

  it('reports the true size whatever the pattern of the notes', () => {
    const patterns: ((i: number) => Place)[] = [
      (i) => [i % 4 === 3 ? 2 : 1, 5],
      (i) => [i % 16 < 8 ? 1 : 2, 5],
      (i) => [i % 32 < 16 ? 1 : 2, 5],
    ]
    for (const place of patterns) {
      const late = (i: number) => (i > 0 && place(i)[0] !== place(i - 1)[0] ? 30 : 0)
      const [habit] = timingHabits(takes((seed) => line(192, place, late, 250, seed), 5))
      expect(habit?.kind).toBe('stringChange')
      expect(Math.abs(habit.ms - 30)).toBeLessThan(4)
    }
  })

  it('counts the passes of one loop as one go', () => {
    const pass = () => take(tallyTiming(line(60, crossing, (i) => (crossed(i) ? 30 : 0)), false, 7))
    expect(timingHabits([pass(), pass(), pass(), pass()])).toEqual([])
  })

  it('does not measure a passage against steady notes far away', () => {
    // Steady, then ten seconds of nothing but string changes, then steady again.
    const place = (i: number): Place => (i < 12 || i >= 52 ? [1, 5] : [i % 2 ? 1 : 2, 5])
    const tally = tallyTiming(line(64, place, (i) => (i >= 12 && i < 52 ? 25 : 0)), false, 1)!
    expect(tally.stringChange).toBeUndefined()
  })

  it('does not count a repeat of one bar as another place', () => {
    const repeated = (seed: number) =>
      line(64, (i) => [i % 8 === 4 || i % 8 === 5 ? 2 : 1, 5], (i) => (i % 8 === 4 ? 40 : 0), 250, seed).map((note, i) => ({ ...note, place: (i % 8) * 240 }))
    expect(timingHabits(takes(repeated, 5))).toEqual([])
  })

  it('keeps a known habit through one long loop', () => {
    const before = takes((seed) => line(60, crossing, (i) => (crossed(i) ? 30 : 0), 250, seed), 4)
    const loop = Array.from({ length: 25 }, () => take(tallyTiming(line(60, crossing, () => 0), false, 99)))
    expect(timingAssessed([...before, ...loop])).toBe(true)
    const stillFound = timingHabits([...before, ...loop.map((item) => ({ ...item, timing: item.timing && { sitting: 99 } }))])
    expect(stillFound[0]?.kind).toBe('stringChange')
  })

  it('does not let one large take outvote the others', () => {
    const tally = (sitting: number, n: number, ms: number): TimingTally => ({
      sitting,
      stringChange: { n, ms, spots: [sitting, sitting + 100, sitting + 200, sitting + 300] },
    })
    expect(timingHabits([take(tally(1, 100, 40)), take(tally(2, 3, 1)), take(tally(3, 3, 1))])).toEqual([])
  })

  it('needs several places in the tab', () => {
    // One bar looped: a single late string change is not a general habit.
    const place = (i: number): Place => (i === 4 ? [2, 5] : [1, 5])
    const makeBar = (seed: number) => line(8, place, (i) => (i === 4 ? 40 : 0), 250, seed)
    expect(timingHabits(takes(makeBar, 6))).toEqual([])
  })

  it('leaves out a move after a long rest or after a missed note', () => {
    expect(tallyTiming(line(30, crossing, () => 0, 1200), false, 1)).toEqual({ sitting: 1 })
    const missing = line(40, crossing, () => 0).map((note, i) => (i % 2 === 1 ? { ...note, offsetMs: null } : note))
    expect(tallyTiming(missing, false, 1)).toEqual({ sitting: 1 })
  })

  it('says nothing about the beat itself without a measured delay', () => {
    const steady = (seed: number) => line(60, () => [1, 5], () => 40, 250, seed)
    expect(tallyTiming(steady(0), false)?.bias).toBeUndefined()
    expect(timingHabits(takes(steady))).toEqual([])
    expect(timingHabits(takes(steady, 3, true))[0].text).toContain('behind the beat')
  })

  it('stays quiet about even playing', () => {
    expect(timingHabits(takes((seed) => line(60, crossing, () => 0, 250, seed), 5))).toEqual([])
  })

  it('skips takes from before timing was kept', () => {
    const made = takes((seed) => line(60, crossing, (i) => (crossed(i) ? 30 : 0), 250, seed))
    expect(timingHabits([take(undefined), ...made])[0]?.kind).toBe('stringChange')
  })

  it('finds fast notes that rush', () => {
    const make = (seed: number) => {
      const notes: TimedNote[] = []
      let at = 0
      for (let i = 0; i < 80; i++) {
        const fast = i % 2 === 1
        at += fast ? 120 : 400
        notes.push({ place: i * 240, timeMs: at, string: 1, fret: 5, offsetMs: (fast ? -25 : 0) + (((i + seed) * 3) % 5) - 2 })
      }
      return notes
    }
    expect(timingHabits(takes(make))[0].text).toContain('rush fast runs')
  })

  it('has nothing to say about a take in which nothing was heard', () => {
    expect(tallyTiming([{ place: 0, timeMs: 0, string: 1, fret: 1, offsetMs: null }], true)).toBeUndefined()
  })
})

describe('a delay that cannot be told apart', () => {
  const steady = Array.from({ length: 40 }, (_, i) => ({ timeMs: i * 250, midi: [60] }))

  it('is flagged on a line repeating one pitch', () => {
    const played = steady.map((note) => ({ timeMs: note.timeMs + 200, midi: [60] }))
    expect(estimateLatency(steady, played)?.ambiguous).toBe(true)
  })

  it('is not flagged when every other note is really late', () => {
    const varied = steady.map((note, i) => ({ ...note, midi: [60 + ((i * i * 3) % 13)] }))
    const played = varied.map((note, i) => ({ timeMs: note.timeMs + 200 + (i % 2 ? 80 : 0), midi: note.midi }))
    expect(estimateLatency(varied, played)?.ambiguous).toBe(false)
  })

  it('is not flagged on a line that varies', () => {
    const varied = steady.map((note, i) => ({ ...note, midi: [60 + ((i * i * 3) % 13)] }))
    const played = varied.map((note) => ({ timeMs: note.timeMs + 200, midi: note.midi }))
    expect(estimateLatency(varied, played)?.ambiguous).toBe(false)
  })
})
