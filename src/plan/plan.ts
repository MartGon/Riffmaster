import type { Song, TakeRecord } from '../library/types'
import { clampSpeed } from '../lib/format'

/**
 * The daily practice plan. Everything here is worked out from the practice
 * history, so a plan needs no storage of its own and follows the history to
 * other devices. It uses only takes from before today, which keeps the plan
 * the same all day while today's takes tick its steps off.
 */

export const PLAN_MINUTES = [10, 20, 30, 45, 60]
export const DEFAULT_PLAN_MINUTES = 20

const DAY_MS = 86_400_000
/** A practice day ends at 4 in the morning, so a late session still counts as the same day. */
const DAY_ROLLOVER_HOUR = 4

/** Share of a bar that must go right for it to count as clean. */
const CLEAN = 0.9
/** Below this a bar is practised again the next day at a lower tempo. */
const SHAKY = 0.7
const MAX_INTERVAL_DAYS = 30
/** How long a bar that is clean, but below the written tempo, can wait: its tempo still has to come up. */
const MAX_INTERVAL_BELOW_TEMPO = 3
const SPEED_UP = 0.05
const SLOW_DOWN = 0.1
const SLOWEST_SUGGESTED = 0.4
/** Speed of a first go at a song. */
const NEW_SONG_SPEED = 0.7
/** Bars of a song not practised yet that a plan starts on. */
const NEW_SONG_BARS = 4

const FOCUS_BARS = 4
const REVIEW_BARS = 8
const FOCUS_MINUTES = 5
const MAX_STEP_MINUTES = 10
const NEW_MINUTES = 5
const REVIEW_MINUTES = 3
/** Share of the time, after the warm-up, that goes to keeping old material first. */
const REVIEW_SHARE = 0.3
/** Most steps from one song while other songs still have something due. */
const STEPS_PER_SONG = 3

/** The practice day a moment falls on, as a whole number of days. */
export function practiceDay(at: number): number {
  // By the clock on the wall, so it stays 4 o'clock when the clocks change.
  const local = new Date(at)
  const date = local.getDate() - (local.getHours() < DAY_ROLLOVER_HOUR ? 1 : 0)
  return Math.round(Date.UTC(local.getFullYear(), local.getMonth(), date) / DAY_MS)
}

/** How well a bar is known, after all its practice days so far. */
export interface BarMemory {
  bar: number
  /** Days until it should be played again. */
  interval: number
  lastDay: number
  dueDay: number
  /** How the first go of the last day went, from 0 to 1; a mistimed note counts half. */
  quality: number
  /** Whether that first go was at the written tempo or faster. */
  atTempo: boolean
  /** Tempo to practise it at next. */
  speed: number
}

interface DaySession {
  /** The first go of the day: what was still there after the time away. */
  coldQuality: number
  coldSpeed: number
  /** Fastest clean go of the day, if any. */
  bestClean: number | null
}

function nextMemory(previous: BarMemory | undefined, bar: number, day: number, session: DaySession): BarMemory {
  const { coldQuality: quality, coldSpeed, bestClean } = session
  const atTempo = coldSpeed >= 1 - 1e-9
  const clean = quality >= CLEAN - 1e-9
  let interval: number
  if (clean) {
    const grown = previous ? Math.max(previous.interval * 2, day - previous.lastDay) : 2
    interval = Math.min(atTempo ? MAX_INTERVAL_DAYS : MAX_INTERVAL_BELOW_TEMPO, grown)
  } else if (quality >= SHAKY) {
    interval = previous ? Math.max(1, Math.floor(previous.interval / 2)) : 1
  } else {
    interval = 1
  }
  let speed: number
  if (clean) speed = (bestClean ?? coldSpeed) + SPEED_UP
  else if (bestClean !== null) speed = bestClean
  else if (quality >= SHAKY) speed = coldSpeed
  else speed = Math.max(Math.min(coldSpeed, SLOWEST_SUGGESTED), coldSpeed - SLOW_DOWN)
  return { bar, interval, lastDay: day, dueDay: day + interval, quality, atTempo, speed: Math.min(1, clampSpeed(speed)) }
}

/** What the takes of one song and track, from before `today`, say about each bar. */
export function barMemories(takes: TakeRecord[], today: number): BarMemory[] {
  const days = new Map<number, Map<number, DaySession>>()
  for (const take of [...takes].sort((a, b) => a.at - b.at)) {
    const day = practiceDay(take.at)
    if (day >= today) continue
    for (const [key, tally] of Object.entries(take.bars)) {
      if (tally.scored === 0) continue
      const bar = Number(key)
      const quality = 1 - (tally.missed + tally.offTime / 2) / tally.scored
      const byDay = days.get(bar) ?? new Map<number, DaySession>()
      days.set(bar, byDay)
      const session = byDay.get(day) ?? { coldQuality: quality, coldSpeed: take.speed, bestClean: null }
      byDay.set(day, session)
      if (quality >= CLEAN - 1e-9) session.bestClean = Math.max(session.bestClean ?? 0, take.speed)
    }
  }
  const memories: BarMemory[] = []
  for (const [bar, byDay] of days) {
    let memory: BarMemory | undefined
    for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
      memory = nextMemory(memory, bar, day, byDay.get(day)!)
    }
    if (memory) memories.push(memory)
  }
  return memories.sort((a, b) => a.bar - b.bar)
}

/** Neighbouring bars due together, up to `maxBars` long; one bar between them may be left out. */
function groupBars(memories: BarMemory[], maxBars: number): BarMemory[][] {
  const groups: BarMemory[][] = []
  for (const memory of memories) {
    const group = groups[groups.length - 1]
    if (group && memory.bar - group[group.length - 1].bar <= 2 && memory.bar - group[0].bar < maxBars) group.push(memory)
    else groups.push([memory])
  }
  return groups
}

export type StepKind = 'warmup' | 'focus' | 'new' | 'review'

export interface PlanStep {
  /** The same for the same step all day. */
  id: string
  kind: StepKind
  minutes: number
  /** Null for a warm-up exercise that may not be in the library yet. */
  songId: string | null
  title: string
  /** Null to let the player choose. */
  trackIndex: number | null
  /** Bars to loop, counted from 0; null for the whole piece. */
  bars: { first: number; last: number } | null
  /** Tempo to play at; null to leave it as it is. */
  speed: number | null
  /** Why this step is in today's plan. */
  reason: string
  /** For a warm-up: the built-in exercise. */
  exercise?: { id: string; fileName: string }
}

export const STEP_LABEL: Record<StepKind, string> = {
  warmup: 'Warm-up',
  focus: 'Focus',
  new: 'New',
  review: 'Review',
}

/** Where a step is and how fast, such as "Bars 9–12 · 80% tempo". */
export function stepDetail(step: PlanStep): string {
  const bars = step.kind === 'new' && step.bars
    ? `First ${step.bars.last - step.bars.first + 1} bars with notes`
    : step.bars
    ? step.bars.first === step.bars.last
      ? `Bar ${step.bars.first + 1}`
      : `Bars ${step.bars.first + 1}–${step.bars.last + 1}`
    : ''
  const speed = step.speed === null ? '' : `${Math.round(step.speed * 100)}% tempo`
  return [bars, speed].filter(Boolean).join(' · ')
}

/** A built-in exercise a plan can warm up with. */
export interface WarmUp {
  id: string
  name: string
  fileName: string
}

type PlanSong = Pick<Song, 'id' | 'title' | 'artist' | 'addedAt' | 'settings'>

/** How many bars and tracks a song had when last opened; history beyond them was edited away. */
/** A song's size when last opened on this device, and how many bars of each track have notes. */
export type SongSizes = Record<string, { bars: number; tracks: number; noted?: Record<number, number> }>

interface Candidate {
  step: PlanStep
  priority: number
}

const percent = (share: number) => `${Math.round(share * 100)}%`

function passageCandidates(song: PlanSong, trackIndex: number, memories: BarMemory[], today: number): Candidate[] {
  const due = memories.filter((memory) => memory.dueDay <= today)
  const needsWork = (memory: BarMemory) => memory.quality < CLEAN - 1e-9 || !memory.atTempo
  const make = (kind: 'focus' | 'review', group: BarMemory[]): Candidate => {
    const first = group[0].bar
    const last = group[group.length - 1].bar
    const quality = group.reduce((sum, memory) => sum + memory.quality, 0) / group.length
    // The hardest bar sets the pace for the passage.
    const speed = Math.min(...group.map((memory) => memory.speed))
    const overdue = Math.max(...group.map((memory) => today - memory.dueDay))
    const away = today - Math.max(...group.map((memory) => memory.lastDay))
    const interval = Math.max(...group.map((memory) => memory.interval))
    const reason =
      kind === 'review'
        ? `Clean ${away} ${away === 1 ? 'day' : 'days'} ago. Check it is still there.`
        : quality >= CLEAN
          ? `Clean at a slower tempo. Bring it up to ${percent(speed)}.`
          : `${percent(quality)} on your first go last time. Get it clean at ${percent(speed)}.`
    return {
      step: {
        id: `${kind}:${song.id}:${trackIndex}:${first}-${last}`,
        kind,
        minutes: kind === 'focus' ? FOCUS_MINUTES : REVIEW_MINUTES,
        songId: song.id,
        title: song.title,
        trackIndex,
        bars: { first, last },
        speed,
        reason,
      },
      priority: kind === 'focus' ? 1 - quality + 0.02 * Math.min(overdue, 10) : (overdue + 1) / interval,
    }
  }
  return [
    ...groupBars(due.filter(needsWork), FOCUS_BARS).map((group) => make('focus', group)),
    ...groupBars(due.filter((memory) => !needsWork(memory)), REVIEW_BARS).map((group) => make('review', group)),
  ]
}

const byPriority = (a: Candidate, b: Candidate) => b.priority - a.priority || a.step.id.localeCompare(b.step.id)

/** Takes candidates in order while they fit, at most `perSong` from one song. */
function pick(candidates: Candidate[], budget: number, chosen: PlanStep[], perSong: number): number {
  let left = budget
  for (const { step } of candidates) {
    if (step.minutes > left) continue
    if (chosen.some((item) => item.id === step.id)) continue
    if (chosen.filter((item) => item.songId === step.songId).length >= perSong) continue
    chosen.push(step)
    left -= step.minutes
  }
  return budget - left
}

/**
 * Today's plan for a session of `minutes`: a warm-up, the passages that most
 * need work, a song not practised yet if there is time, and last the old
 * material that is due, so a session ends on something that goes well.
 */
export function buildPlan(
  songs: PlanSong[],
  takes: TakeRecord[],
  now: number,
  minutes: number,
  warmUps: WarmUp[],
  sizes: SongSizes = {},
): PlanStep[] {
  const today = practiceDay(now)
  const candidates: Candidate[] = []
  const unpractised: PlanSong[] = []
  for (const song of songs) {
    // Exercises are warm-ups and drills, not material to keep up.
    if (song.artist === 'Exercise') continue
    const ownTakes = takes.filter((take) => take.songId === song.id && practiceDay(take.at) < today)
    if (ownTakes.length === 0) {
      // Also when first played today: the step stays in the plan, ticked off.
      unpractised.push(song)
      continue
    }
    const size = sizes[song.id]
    for (const trackIndex of new Set(ownTakes.map((take) => take.trackIndex))) {
      if (size && trackIndex >= size.tracks) continue
      const memories = barMemories(ownTakes.filter((take) => take.trackIndex === trackIndex), today).filter(
        (memory) => !size || memory.bar < size.bars,
      )
      candidates.push(...passageCandidates(song, trackIndex, memories, today))
    }
  }
  candidates.sort(byPriority)

  const steps: PlanStep[] = []
  const warmUp = warmUps.length > 0 ? warmUps[((today % warmUps.length) + warmUps.length) % warmUps.length] : null
  const warmUpMinutes = warmUp ? (minutes <= 10 ? 2 : 3) : 0
  let left = minutes - warmUpMinutes

  // Old material gets its share first, then the rest goes to what needs work.
  const reviews = candidates.filter(({ step }) => step.kind === 'review')
  const focuses = candidates.filter(({ step }) => step.kind === 'focus')
  const review: PlanStep[] = []
  left -= pick(reviews, Math.floor(left * REVIEW_SHARE), review, STEPS_PER_SONG)
  const focus: PlanStep[] = []
  left -= pick(focuses, left, focus, STEPS_PER_SONG)
  left -= pick(focuses, left, focus, Infinity)
  left -= pick(reviews, left, review, Infinity)

  const learn: PlanStep[] = []
  if (left >= NEW_MINUTES && unpractised.length > 0) {
    const song = [...unpractised].sort((a, b) => b.addedAt - a.addedAt || a.id.localeCompare(b.id))[0]
    learn.push({
      id: `new:${song.id}`,
      kind: 'new',
      minutes: NEW_MINUTES,
      songId: song.id,
      title: song.title,
      trackIndex: song.settings.trackIndex,
      bars: { first: 0, last: NEW_SONG_BARS - 1 },
      speed: NEW_SONG_SPEED,
      reason: 'Not practised yet. Learn the first bars slowly.',
    })
    left -= NEW_MINUTES
  }

  // Spare time goes to the steps that are about learning something.
  const growing = [...focus, ...learn]
  for (let index = 0; left > 0 && growing.some((step) => step.minutes < MAX_STEP_MINUTES); index++) {
    const step = growing[index % growing.length]
    if (step.minutes >= MAX_STEP_MINUTES) continue
    step.minutes++
    left--
  }

  if (warmUp) {
    steps.push({
      id: `warmup:${warmUp.id}`,
      kind: 'warmup',
      minutes: warmUpMinutes,
      songId: null,
      title: warmUp.name,
      trackIndex: null,
      bars: null,
      speed: null,
      reason: 'Warm up your hands before the hard parts.',
      exercise: { id: warmUp.id, fileName: warmUp.fileName },
    })
  }
  return [...steps, ...focus, ...learn, ...review]
}

/** Whether a take from today does what a step asks for. */
export function takeCompletesStep(step: PlanStep, take: TakeRecord, songFileName: string | undefined): boolean {
  if (step.kind === 'warmup') return songFileName === step.exercise?.fileName
  if (take.songId !== step.songId) return false
  if (step.kind === 'new') return true
  if (take.trackIndex !== step.trackIndex || !step.bars) return false
  return take.startBar <= step.bars.first && take.endBar >= step.bars.last
}

/** The steps a list of takes from today has completed, by step id. */
export function completedSteps(
  steps: PlanStep[],
  takes: TakeRecord[],
  songs: Pick<Song, 'id' | 'fileName'>[],
  now: number,
): Set<string> {
  const today = practiceDay(now)
  const fileNames = new Map(songs.map((song) => [song.id, song.fileName]))
  const done = new Set<string>()
  for (const take of takes) {
    if (practiceDay(take.at) !== today) continue
    for (const step of steps) {
      if (takeCompletesStep(step, take, fileNames.get(take.songId))) done.add(step.id)
    }
  }
  return done
}
