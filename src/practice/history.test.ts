import { describe, expect, it } from 'vitest'
import type { TakeRecord } from '../library/types'
import { summarizeHistory, tallyBars, troubleBars } from './history'
import type { NoteGrade } from './matching'

const results = (grades: NoteGrade[]) => grades.map((grade) => ({ grade, offsetMs: null }))

const take = (at: number, bars: TakeRecord['bars'], change: Partial<TakeRecord> = {}): TakeRecord => ({
  id: String(at),
  songId: 's',
  at,
  trackIndex: 0,
  speed: 1,
  startBar: 0,
  endBar: 9,
  scored: 10,
  onTime: 8,
  early: 0,
  late: 0,
  missed: 2,
  accuracy: 0.8,
  bars,
  trainer: false,
  ...change,
})

describe('tallyBars', () => {
  it('counts scored, missed and mistimed notes per bar', () => {
    const tally = tallyBars(
      [0, 0, 0, 1, 1, 2],
      results(['onTime', 'missed', 'late', 'early', 'unscored', 'unscored']),
    )
    expect(tally).toEqual({
      0: { scored: 3, missed: 1, offTime: 1 },
      1: { scored: 1, missed: 0, offTime: 1 },
    })
  })
})

describe('troubleBars', () => {
  it('ranks bars by the share of notes that went wrong', () => {
    const takes = [
      take(1, { 3: { scored: 4, missed: 3, offTime: 0 }, 5: { scored: 8, missed: 2, offTime: 2 } }),
      take(2, { 3: { scored: 4, missed: 2, offTime: 0 }, 7: { scored: 4, missed: 0, offTime: 0 } }),
    ]
    expect(troubleBars(takes).map((t) => t.bar)).toEqual([3, 5])
    expect(troubleBars(takes)[0]).toMatchObject({ scored: 8, missed: 5, trouble: 5 / 8 })
  })

  it('ignores a single slip', () => {
    expect(troubleBars([take(1, { 3: { scored: 4, missed: 1, offTime: 0 } })])).toEqual([])
  })

  it('looks only at recent takes', () => {
    const bad = { 3: { scored: 4, missed: 4, offTime: 0 } }
    const good = { 3: { scored: 4, missed: 0, offTime: 0 } }
    const takes = [take(1, bad), ...[2, 3, 4, 5, 6].map((at) => take(at, good))]
    expect(troubleBars(takes)).toEqual([])
    expect(troubleBars(takes.slice(0, 2))).toHaveLength(1)
    expect(troubleBars(takes.slice(0, 2), { recent: 1 })).toEqual([])
  })

  it('limits how many bars are returned', () => {
    const bars: TakeRecord['bars'] = {}
    for (let bar = 0; bar < 6; bar++) bars[bar] = { scored: 4, missed: 2 + (bar % 2), offTime: 0 }
    expect(troubleBars([take(1, bars)])).toHaveLength(3)
    expect(troubleBars([take(1, bars)], { limit: 2 }).map((t) => t.bar)).toEqual([1, 3])
  })
})

describe('summarizeHistory', () => {
  it('prefers the faster of two equally accurate takes', () => {
    const takes = [
      take(1, {}, { accuracy: 0.9, speed: 0.6 }),
      take(2, {}, { accuracy: 0.9, speed: 0.8 }),
      take(3, {}, { accuracy: 0.7, speed: 1 }),
    ]
    const summary = summarizeHistory(takes)
    expect(summary.takes).toBe(3)
    expect(summary.best?.at).toBe(2)
    expect(summary.last?.at).toBe(3)
  })

  it('handles an empty history', () => {
    expect(summarizeHistory([])).toEqual({ takes: 0, best: null, last: null })
  })
})
