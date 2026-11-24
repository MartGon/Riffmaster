import { describe, expect, it } from 'vitest'
import type { BarTally, TakeRecord } from '../library/types'
import { barStandings, practiceStreak, progressBySong, songProgress, weekMinutes } from './progress'

const DAY = 86_400_000
/** Noon on a day, so the 4 a.m. rollover does not move it. */
const noon = (day: number) => new Date(2026, 10, 1 + day, 12).getTime()
let id = 0
const take = (day: number, bars: Record<number, BarTally>, change: Partial<TakeRecord> = {}): TakeRecord => ({
  id: String(id++),
  songId: 's',
  at: noon(day) + id,
  trackIndex: 0,
  speed: 1,
  startBar: 0,
  endBar: 3,
  scored: 8,
  onTime: 8,
  early: 0,
  late: 0,
  missed: 0,
  accuracy: 1,
  bars,
  trainer: false,
  ...change,
})
const clean = { scored: 4, missed: 0, offTime: 0 }
const half = { scored: 4, missed: 2, offTime: 0 }

describe('song progress', () => {
  it('judges each bar by its first go on the last day it was played', () => {
    const takes = [take(0, { 0: half, 1: half }), take(1, { 0: half }), take(1, { 0: clean, 1: clean })]
    const standings = barStandings(takes, 0)
    // Bar 0 went badly first thing on day 1; bar 1 was first played that day cleanly.
    expect(standings).toEqual([
      { bar: 0, quality: 0.5, speed: 1 },
      { bar: 1, quality: 1, speed: 1 },
    ])
  })

  it('counts how cleanly and how near tempo, over the bars with notes', () => {
    const takes = [take(0, { 0: clean, 1: clean }, { speed: 1 }), take(0, { 2: clean }, { speed: 0.5 })]
    const progress = songProgress(takes, { bars: 8, tracks: 1, noted: { 0: 8 } })!
    expect(progress.mastered).toBe(2)
    expect(progress.learning).toBe(1)
    expect(progress.total).toBe(8)
    expect(progress.mastery).toBeCloseTo(2.5 / 8)
  })

  it('without a count of bars, uses the bars played', () => {
    expect(songProgress([take(0, { 0: clean, 1: half })])!.mastery).toBeCloseTo(0.75)
  })

  it('follows the track practised most, unless told which', () => {
    const takes = [take(0, { 0: clean }, { trackIndex: 1 }), take(0, { 0: half }, { trackIndex: 1 }), take(0, { 0: half })]
    expect(songProgress(takes)!.trackIndex).toBe(1)
    expect(songProgress(takes, undefined, 0)!.mastery).toBeCloseTo(0.5)
    expect(songProgress(takes, undefined, 2)).toBeNull()
  })

  it('ignores a damaged count of bars', () => {
    expect(songProgress([take(0, { 0: clean })], { bars: 1, tracks: 1, noted: { 0: 'x' as unknown as number } })!.total).toBe(1)
  })

  it('leaves out bars and tracks edited away', () => {
    // The song was 40 bars, now 20; only the old bars past 20 were ever played.
    const shortened = [take(0, { 25: clean, 30: clean })]
    expect(songProgress(shortened, { bars: 20, tracks: 1, noted: { 0: 20 } })).toMatchObject({ mastery: 0, mastered: 0, total: 20 })
    // Track 1 was deleted: the library follows track 0.
    const tracks = [take(0, { 0: clean }, { trackIndex: 1 }), take(0, { 0: clean }, { trackIndex: 1 }), take(0, { 0: half })]
    expect(songProgress(tracks, { bars: 50, tracks: 1, noted: { 0: 50 } })).toMatchObject({ trackIndex: 0, total: 50 })
  })

  it('works out every song', () => {
    const all = [take(0, { 0: clean }), take(0, { 0: half }, { songId: 't' })]
    const map = progressBySong(all, { t: { bars: 4, tracks: 1, noted: { 0: 4 } } })
    expect(map.get('s')!.mastery).toBe(1)
    expect(map.get('t')!.mastery).toBeCloseTo(0.5 / 4)
  })
})

describe('practice over time', () => {
  it('counts days in a row, still holding until today is over', () => {
    const takes = [take(0, {}), take(1, {}), take(2, {}), take(4, {})]
    expect(practiceStreak(takes, noon(4))).toBe(1)
    expect(practiceStreak(takes, noon(3))).toBe(3)
    expect(practiceStreak(takes, noon(6))).toBe(0)
    expect(practiceStreak([], noon(0))).toBe(0)
  })

  it('adds up the minutes of the last seven days', () => {
    const takes = [take(0, {}, { durationMs: 10 * 60_000 }), take(6, {}, { durationMs: 5 * 60_000 }), take(7, {}, { durationMs: 60_000 }), take(7, {})]
    expect(weekMinutes(takes, noon(7))).toBe(6)
    expect(weekMinutes(takes, noon(6))).toBe(15)
    expect(weekMinutes(takes, noon(6) + 30 * DAY)).toBe(0)
  })
})
