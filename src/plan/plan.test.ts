import { describe, expect, it } from 'vitest'
import { defaultSongSettings, type TakeRecord } from '../library/types'
import { EXERCISES } from '../exercises/catalogue'
import { barMemories, buildPlan, completedSteps, practiceDay, type WarmUp } from './plan'
import { WARMUPS } from './warmups'

const noon = (day: number) => new Date(2026, 10, day, 12).getTime()
const today = practiceDay(noon(20))

let nextId = 0
function take(day: number, bars: Record<number, [scored: number, missed: number]>, change: Partial<TakeRecord> = {}): TakeRecord {
  const keys = Object.keys(bars).map(Number)
  return {
    id: `t${nextId++}`,
    songId: 'a',
    at: noon(day),
    trackIndex: 0,
    speed: 1,
    startBar: Math.min(...keys),
    endBar: Math.max(...keys),
    scored: 8,
    onTime: 8,
    early: 0,
    late: 0,
    missed: 0,
    accuracy: 1,
    bars: Object.fromEntries(keys.map((bar) => [bar, { scored: bars[bar][0], missed: bars[bar][1], offTime: 0 }])),
    trainer: false,
    ...change,
  }
}
const song = (id: string, addedAt = 1, artist = 'Band') => ({ id, title: id.toUpperCase(), artist, addedAt, settings: defaultSongSettings })
const warm: WarmUp[] = [{ id: 'spider', name: 'Spider', fileName: 'spider.gp' }]

describe('practice day', () => {
  it('counts the small hours as the day before', () => {
    expect(practiceDay(new Date(2026, 10, 20, 2).getTime())).toBe(practiceDay(new Date(2026, 10, 19, 22).getTime()))
    expect(practiceDay(new Date(2026, 10, 20, 5).getTime())).toBe(practiceDay(new Date(2026, 10, 19, 22).getTime()) + 1)
  })

  it('turns over at 4 by the clock on the day the clocks change', () => {
    // Clocks go forward in Europe on 28 March 2027 and back on 31 October 2027.
    for (const [month, date] of [[2, 28], [9, 31]]) {
      const before = practiceDay(new Date(2027, month, date, 3, 59).getTime())
      expect(practiceDay(new Date(2027, month, date, 4, 0).getTime())).toBe(before + 1)
    }
  })

  it('moves by one across a month end', () => {
    expect(practiceDay(new Date(2026, 11, 1, 12).getTime()) - practiceDay(new Date(2026, 10, 30, 12).getTime())).toBe(1)
  })
})

describe('spacing', () => {
  it('doubles the wait each time a bar is clean at tempo', () => {
    const [memory] = barMemories([take(10, { 0: [8, 0] }), take(12, { 0: [8, 0] }), take(16, { 0: [8, 0] })], today)
    expect(memory.interval).toBe(8)
    expect(memory.dueDay).toBe(practiceDay(noon(24)))
  })

  it('brings a bar that went wrong back the next day, at a lower tempo', () => {
    const [memory] = barMemories([take(10, { 0: [8, 0] }), take(12, { 0: [8, 4] }, { speed: 0.8 })], today)
    expect(memory.interval).toBe(1)
    expect(memory.speed).toBe(0.7)
  })

  it('judges a day by its first go, and keeps the tempo reached later that day', () => {
    const cold = take(10, { 0: [8, 4] }, { speed: 1, at: noon(10) })
    const warmedUp = take(10, { 0: [8, 0] }, { speed: 0.75, at: noon(10) + 60_000 })
    const [memory] = barMemories([warmedUp, cold], today)
    expect(memory.quality).toBe(0.5)
    expect(memory.interval).toBe(1)
    expect(memory.speed).toBe(0.75)
  })

  it('does not let a bar clean below tempo wait long', () => {
    const takes = [10, 11, 13, 16].map((day) => take(day, { 0: [8, 0] }, { speed: 0.6 }))
    const [memory] = barMemories(takes, today)
    expect(memory.interval).toBe(3)
    expect(memory.speed).toBe(0.65)
  })

  it('never suggests more than the written tempo', () => {
    expect(barMemories([take(10, { 0: [8, 0] }, { speed: 1.2 })], today)[0].speed).toBe(1)
  })

  it('leaves out what was played today', () => {
    expect(barMemories([take(20, { 0: [8, 4] })], today)).toEqual([])
  })
})

describe('the plan', () => {
  it('starts with a warm-up and fits the time', () => {
    const takes = [take(18, { 0: [8, 4], 1: [8, 4], 5: [8, 3], 9: [8, 4], 20: [8, 5] })]
    for (const minutes of [10, 20, 30, 45, 60]) {
      const steps = buildPlan([song('a')], takes, noon(20), minutes, warm)
      expect(steps[0].kind).toBe('warmup')
      expect(steps.reduce((sum, step) => sum + step.minutes, 0)).toBeLessThanOrEqual(minutes)
    }
  })

  it('puts the weakest passage first and joins neighbouring bars', () => {
    const takes = [take(18, { 2: [8, 2], 3: [8, 2], 10: [8, 6] })]
    const steps = buildPlan([song('a')], takes, noon(20), 20, warm).filter((step) => step.kind === 'focus')
    expect(steps.map((step) => step.bars)).toEqual([{ first: 10, last: 10 }, { first: 2, last: 3 }])
  })

  it('keeps a passage to four bars', () => {
    const bars = Object.fromEntries(Array.from({ length: 10 }, (_, bar) => [bar, [8, 4] as [number, number]]))
    const steps = buildPlan([song('a')], [take(18, bars)], noon(20), 60, warm).filter((step) => step.kind === 'focus')
    expect(steps.every((step) => step.bars!.last - step.bars!.first < 4)).toBe(true)
    expect(new Set(steps.flatMap((step) => [step.bars!.first, step.bars!.last])).size).toBeGreaterThan(2)
  })

  it('reviews clean bars that are due and leaves the others alone', () => {
    const takes = [take(10, { 0: [8, 0] }), take(12, { 0: [8, 0] }), take(18, { 4: [8, 0] })]
    const steps = buildPlan([song('a')], takes, noon(20), 30, warm)
    expect(steps.filter((step) => step.kind === 'review').map((step) => step.bars)).toEqual([
      { first: 0, last: 0 },
      { first: 4, last: 4 },
    ])
    const later = buildPlan([song('a')], [take(19, { 0: [8, 0] })], noon(20), 30, warm)
    expect(later.some((step) => step.kind === 'review')).toBe(false)
  })

  it('keeps old material in the plan when new problems would fill it', () => {
    const weak = Object.fromEntries(Array.from({ length: 40 }, (_, bar) => [bar * 3, [8, 5] as [number, number]]))
    const takes = [take(10, { 100: [8, 0] }), take(19, weak)]
    const steps = buildPlan([song('a')], takes, noon(20), 20, warm)
    expect(steps.some((step) => step.kind === 'review')).toBe(true)
  })

  it('offers a song not practised yet when there is time, newest first', () => {
    const steps = buildPlan([song('old', 1), song('recent', 2)], [], noon(20), 20, warm)
    expect(steps.map((step) => step.kind)).toEqual(['warmup', 'new'])
    expect(steps[1].songId).toBe('recent')
  })

  it('leaves exercises out of the songs to keep up', () => {
    const takes = [take(18, { 0: [8, 5] }, { songId: 'x' })]
    const steps = buildPlan([song('x', 1, 'Exercise')], takes, noon(20), 20, warm)
    expect(steps.map((step) => step.kind)).toEqual(['warmup'])
  })

  it('stays the same through the day as takes come in', () => {
    const takes = [take(18, { 0: [8, 4], 8: [8, 3] })]
    const before = buildPlan([song('a')], takes, noon(20), 20, warm)
    const after = buildPlan([song('a')], [...takes, take(20, { 0: [8, 0] })], noon(20) + 3_600_000, 20, warm)
    expect(after).toEqual(before)
  })

  it('keeps a new song in the plan once it was played today, so it can be ticked off', () => {
    const songs = [song('a', 2), song('b', 1)]
    const before = buildPlan(songs, [], noon(20), 20, warm)
    const played = [take(20, { 0: [8, 0] })]
    const after = buildPlan(songs, played, noon(20) + 60_000, 20, warm)
    expect(after).toEqual(before)
    expect(completedSteps(after, played, [{ id: 'a', fileName: 'a.gp' }], noon(20) + 60_000).has('new:a')).toBe(true)
  })

  it('drops bars and tracks that were edited out of the song', () => {
    const takes = [take(18, { 2: [8, 5], 30: [8, 5] }), take(18, { 2: [8, 5] }, { trackIndex: 4 })]
    const steps = buildPlan([song('a')], takes, noon(20), 30, warm, { a: { bars: 10, tracks: 2 } })
    expect(steps.filter((step) => step.kind === 'focus').map((step) => [step.trackIndex, step.bars])).toEqual([
      [0, { first: 2, last: 2 }],
    ])
  })

  it('does not offer a song first played today as new again tomorrow', () => {
    const steps = buildPlan([song('a')], [take(20, { 0: [8, 0] })], noon(21), 20, warm)
    expect(steps.some((step) => step.kind === 'new')).toBe(false)
  })
})

describe('ticking steps off', () => {
  const steps = buildPlan([song('a')], [take(18, { 2: [8, 4], 3: [8, 4] })], noon(20), 20, warm)
  const focus = steps.find((step) => step.kind === 'focus')!
  const songs = [{ id: 'a', fileName: 'a.gp' }, { id: 'w', fileName: 'spider.gp' }]

  it('needs a take today that covers the whole passage', () => {
    expect(completedSteps(steps, [take(20, { 2: [8, 1] })], songs, noon(20)).has(focus.id)).toBe(false)
    expect(completedSteps(steps, [take(20, { 2: [8, 1], 3: [8, 1] })], songs, noon(20)).has(focus.id)).toBe(true)
    expect(completedSteps(steps, [take(19, { 2: [8, 1], 3: [8, 1] })], songs, noon(20)).has(focus.id)).toBe(false)
  })

  it('does not count another track', () => {
    expect(completedSteps(steps, [take(20, { 2: [8, 1], 3: [8, 1] }, { trackIndex: 1 })], songs, noon(20)).has(focus.id)).toBe(false)
  })

  it('finds a warm-up by its exercise', () => {
    expect(completedSteps(steps, [take(20, { 0: [8, 0] }, { songId: 'w' })], songs, noon(20)).has('warmup:spider')).toBe(true)
  })
})

describe('warm-ups', () => {
  it('are all built-in exercises', () => {
    expect(WARMUPS.length).toBeGreaterThan(1)
    for (const warmUp of WARMUPS) expect(EXERCISES.some((exercise) => exercise.id === warmUp.id)).toBe(true)
  })
})
