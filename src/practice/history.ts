import type { BarTally, TakeRecord } from '../library/types'
import type { NoteResult } from './matching'

/**
 * Takes with fewer scored notes than this say too little to be worth
 * keeping. Takes in which no note at all was heard are not kept either.
 */
export const MIN_NOTES_TO_RECORD = 4

/** Tallies a take's results per bar. `bars[i]` is the bar of the note `results[i]` belongs to. */
export function tallyBars(bars: number[], results: NoteResult[]): Record<number, BarTally> {
  const tally: Record<number, BarTally> = {}
  results.forEach((result, index) => {
    if (result.grade === 'unscored') return
    const entry = (tally[bars[index]] ??= { scored: 0, missed: 0, offTime: 0 })
    entry.scored++
    if (result.grade === 'missed') entry.missed++
    else if (result.grade !== 'onTime') entry.offTime++
  })
  return tally
}

export interface TroubleBar {
  /** Bar index, counted from 0. */
  bar: number
  /** Share of the bar's notes that went wrong, from 0 to 1; a mistimed note counts half. */
  trouble: number
  scored: number
  missed: number
  offTime: number
}

/**
 * Finds the bars that go wrong most often, from the most recent takes.
 * Bars that only went wrong once in a single note are left out, as that is
 * as likely a slip as a habit.
 */
export function troubleBars(takes: TakeRecord[], options: { recent?: number; limit?: number } = {}): TroubleBar[] {
  const recent = takes.slice(-(options.recent ?? 5))
  const totals = new Map<number, BarTally>()
  for (const take of recent) {
    for (const [bar, tally] of Object.entries(take.bars)) {
      const entry = totals.get(Number(bar)) ?? { scored: 0, missed: 0, offTime: 0 }
      entry.scored += tally.scored
      entry.missed += tally.missed
      entry.offTime += tally.offTime
      totals.set(Number(bar), entry)
    }
  }
  const list: TroubleBar[] = []
  for (const [bar, tally] of totals) {
    const weight = tally.missed + tally.offTime / 2
    if (weight < 1.5) continue
    const trouble = weight / tally.scored
    if (trouble < 0.25) continue
    list.push({ bar, trouble, ...tally })
  }
  list.sort((a, b) => b.trouble - a.trouble || b.missed - a.missed || a.bar - b.bar)
  return list.slice(0, options.limit ?? 3)
}

export interface HistorySummary {
  takes: number
  best: TakeRecord | null
  last: TakeRecord | null
}

export function summarizeHistory(takes: TakeRecord[]): HistorySummary {
  let best: TakeRecord | null = null
  for (const take of takes) {
    // Between equally accurate takes the faster one is the better.
    if (!best || take.accuracy > best.accuracy || (take.accuracy === best.accuracy && take.speed >= best.speed)) {
      best = take
    }
  }
  return { takes: takes.length, best, last: takes[takes.length - 1] ?? null }
}
