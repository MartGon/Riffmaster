import type { TakeRecord } from '../library/types'
import { practiceDay, type SongSizes } from '../plan/plan'

/**
 * How far along a song is, from its practice history. Each bar is judged by
 * the first time it was played on the last day it was practised: what was
 * still there after the time away, not what a warmed-up hand managed.
 */

/** Share of a bar that must go right for it to count as clean; as in the plan. */
const CLEAN = 0.9

export interface BarStanding {
  bar: number
  /** How that first go went, from 0 to 1; a mistimed note counts half. */
  quality: number
  /** Its speed, 1 being the written tempo. */
  speed: number
}

/** Where each bar of one track stands, from its takes. */
export function barStandings(takes: TakeRecord[], trackIndex: number): BarStanding[] {
  const latest = new Map<number, BarStanding & { day: number; at: number }>()
  for (const take of [...takes].sort((a, b) => a.at - b.at)) {
    if (take.trackIndex !== trackIndex) continue
    const day = practiceDay(take.at)
    for (const [key, tally] of Object.entries(take.bars)) {
      if (tally.scored === 0) continue
      const bar = Number(key)
      const known = latest.get(bar)
      // The first go of a later day replaces what was known; later goes that day do not.
      if (known && known.day === day) continue
      const quality = 1 - (tally.missed + tally.offTime / 2) / tally.scored
      latest.set(bar, { bar, quality, speed: take.speed, day, at: take.at })
    }
  }
  return [...latest.values()].map(({ bar, quality, speed }) => ({ bar, quality, speed })).sort((a, b) => a.bar - b.bar)
}

export interface SongProgress {
  /** The track most practised, which the figures are for. */
  trackIndex: number
  /** From 0 to 1: each bar counts by how cleanly and how near the written tempo it went. */
  mastery: number
  /** Bars clean at the written tempo. */
  mastered: number
  /** Bars played, but not yet clean at tempo. */
  learning: number
  /** Bars with notes in the track; bars not played yet count as nothing. */
  total: number
  takes: number
  lastAt: number
}

/** A bar's part of the mastery figure: how cleanly, times how near the written tempo. */
export const barCredit = (standing: BarStanding) => standing.quality * Math.min(1, standing.speed)
export const isMastered = (standing: BarStanding) => standing.quality >= CLEAN - 1e-9 && standing.speed >= 1 - 1e-9

const count = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null)

/**
 * Progress on one song. `size` is the song as last opened on this device:
 * history of bars or tracks since edited away is left out, as in the plan,
 * and bars with notes but not played yet count as nothing. Without it only
 * the bars practised so far are counted.
 */
export function songProgress(all: TakeRecord[], size?: SongSizes[string], trackIndex?: number): SongProgress | null {
  // Kept on the device as it was found; anything odd there is ignored.
  const bars = count(size?.bars)
  const tracks = count(size?.tracks)
  const takes = tracks === null ? all : all.filter((take) => take.trackIndex < tracks)
  if (takes.length === 0) return null
  let track = trackIndex
  if (track === undefined) {
    const counts = new Map<number, number>()
    for (const take of takes) counts.set(take.trackIndex, (counts.get(take.trackIndex) ?? 0) + 1)
    track = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
  }
  const own = takes.filter((take) => take.trackIndex === track)
  if (own.length === 0) return null
  const standings = barStandings(own, track).filter((standing) => bars === null || standing.bar < bars)
  const noted = count(size?.noted?.[track])
  const total = noted ?? standings.length
  const mastered = standings.filter(isMastered).length
  const credit = standings.reduce((sum, standing) => sum + barCredit(standing), 0)
  return {
    trackIndex: track,
    mastery: total > 0 ? Math.min(1, credit / total) : 0,
    mastered: Math.min(mastered, total),
    learning: Math.min(standings.length, total) - Math.min(mastered, total),
    total,
    takes: own.length,
    lastAt: Math.max(...own.map((take) => take.at)),
  }
}

/** Progress on every song with takes, keyed by song id. */
export function progressBySong(takes: TakeRecord[], sizes: SongSizes): Map<string, SongProgress> {
  const bySong = new Map<string, TakeRecord[]>()
  for (const take of takes) {
    const list = bySong.get(take.songId) ?? []
    list.push(take)
    bySong.set(take.songId, list)
  }
  const out = new Map<string, SongProgress>()
  for (const [songId, list] of bySong) {
    const progress = songProgress(list, sizes[songId])
    if (progress) out.set(songId, progress)
  }
  return out
}

/** Days in a row with practice, up to today; a streak holds through today until the day is over. */
export function practiceStreak(takes: TakeRecord[], now: number): number {
  const days = new Set(takes.map((take) => practiceDay(take.at)))
  const today = practiceDay(now)
  let day = days.has(today) ? today : today - 1
  let streak = 0
  while (days.has(day)) {
    streak++
    day--
  }
  return streak
}

/** Minutes of takes over the last seven practice days, today included. Takes from before durations were kept count nothing. */
export function weekMinutes(takes: TakeRecord[], now: number): number {
  const today = practiceDay(now)
  let ms = 0
  for (const take of takes) {
    const day = practiceDay(take.at)
    // A device clock set wrong can leave a take in the future; it is not this week's.
    if (day >= today - 6 && day <= today) ms += take.durationMs ?? 0
  }
  return Math.round(ms / 60000)
}
