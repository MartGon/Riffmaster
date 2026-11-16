import type * as alphaTab from '@coderline/alphatab'
import type { ExpectedNote } from './matching'

type TickLookup = NonNullable<alphaTab.AlphaTabApi['tickCache']>

/** An expected note together with the tab notes it came from, for marking them afterwards. */
export interface TabNote extends ExpectedNote {
  /** Position in playback ticks, with repeats played out. */
  tick: number
  /** Bar the note is written in, counted from 0. */
  bar: number
  notes: alphaTab.model.Note[]
}

const TICKS_PER_QUARTER = 960

/**
 * Builds a function giving the time in milliseconds at which a playback tick
 * is reached at the written tempo, following every tempo change in the song.
 */
export function buildTimeMap(lookup: TickLookup): (tick: number) => number {
  const changes: { tick: number; tempo: number }[] = []
  for (const bar of lookup.masterBars) {
    for (const change of bar.tempoChanges) changes.push({ tick: change.tick, tempo: change.tempo })
  }
  changes.sort((a, b) => a.tick - b.tick)
  const firstTempo = changes[0]?.tempo ?? lookup.masterBars[0]?.tempo ?? 120
  // Segments of constant tempo, each with the time at which it starts.
  const segments: { tick: number; tempo: number; ms: number }[] = [{ tick: 0, tempo: firstTempo, ms: 0 }]
  for (const change of changes) {
    const last = segments[segments.length - 1]
    if (change.tick <= last.tick) {
      last.tempo = change.tempo
      continue
    }
    if (change.tempo === last.tempo) continue
    const ms = last.ms + ((change.tick - last.tick) * 60000) / (last.tempo * TICKS_PER_QUARTER)
    segments.push({ tick: change.tick, tempo: change.tempo, ms })
  }
  return (tick: number) => {
    let index = segments.length - 1
    while (index > 0 && segments[index].tick > tick) index--
    const segment = segments[index]
    return segment.ms + ((tick - segment.tick) * 60000) / (segment.tempo * TICKS_PER_QUARTER)
  }
}

/**
 * Lists the notes a track should play, in playback order, optionally limited
 * to a range of ticks. Times are in milliseconds at the given playback speed.
 * Rests, tied continuations, muted "dead" notes and grace notes are left out.
 */
export function collectExpected(
  lookup: TickLookup,
  trackIndex: number,
  speed: number,
  range: { startTick: number; endTick: number } | null,
): TabNote[] {
  const timeAt = buildTimeMap(lookup)
  const byTick = new Map<number, TabNote>()
  const seen = new Set<string>()
  for (const bar of lookup.masterBars) {
    for (let slice = bar.firstBeat; slice; slice = slice.nextBeat) {
      for (const item of slice.highlightedBeats) {
        const beat = item.beat
        // A beat's start is stored relative to the bar it is played in.
        const tick = bar.start + item.playbackStart
        if (beat.voice.bar.staff.track.index !== trackIndex) continue
        if (range && (tick < range.startTick || tick >= range.endTick)) continue
        const key = `${beat.id}:${tick}`
        if (seen.has(key)) continue
        seen.add(key)
        if (beat.isRest || beat.graceType !== 0) continue
        const notes = beat.notes.filter((note) => !note.isTieDestination && !note.isDead)
        if (notes.length === 0) continue
        let entry = byTick.get(tick)
        if (!entry) {
          entry = { tick, bar: beat.voice.bar.index, timeMs: timeAt(tick) / speed, midi: [], notes: [] }
          byTick.set(tick, entry)
        }
        for (const note of notes) {
          entry.midi.push(note.realValue)
          entry.notes.push(note)
        }
      }
      if (slice === bar.lastBeat) break
    }
  }
  return [...byTick.values()].sort((a, b) => a.tick - b.tick)
}
