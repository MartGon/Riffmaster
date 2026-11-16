import * as alphaTab from '@coderline/alphatab'
import { type Finger, type FingerEvent, type FingerNote, recommend } from './recommend'

type Track = alphaTab.model.Track
type Note = alphaTab.model.Note

/** The finger for one note of the tab, as shown to the player. */
export interface NoteFingering {
  /** 1 is the index finger, 4 the little finger; 'T' is the thumb, which only files ask for. */
  finger: Finger | 'T'
  /** Whether the file said so, or the app worked it out. */
  source: 'file' | 'suggested'
  /** Fret under the index finger at that moment, counted from the nut; null when unknown. */
  position: number | null
}

/** Fingerings by `Note.id`. */
export type Fingerings = Map<number, NoteFingering>

const TICKS_PER_QUARTER = 960
/** A ringing note is not expected to be held for longer than this. */
const LONGEST_RING = 2 * 4 * TICKS_PER_QUARTER

/** Time in milliseconds at which a tick of the written song is reached, repeats not played out. */
function timeMap(score: alphaTab.model.Score): (tick: number) => number {
  const segments: { tick: number; tempo: number; ms: number }[] = [{ tick: 0, tempo: score.tempo || 120, ms: 0 }]
  for (const bar of score.masterBars) {
    const length = bar.calculateDuration()
    for (const change of bar.tempoAutomations) {
      const tick = bar.start + Math.round(change.ratioPosition * length)
      const last = segments[segments.length - 1]
      if (!(change.value > 0) || change.value === last.tempo) continue
      if (tick <= last.tick) last.tempo = change.value
      else {
        const ms = last.ms + ((tick - last.tick) * 60000) / (last.tempo * TICKS_PER_QUARTER)
        segments.push({ tick, tempo: change.value, ms })
      }
    }
  }
  return (tick) => {
    let index = segments.length - 1
    while (index > 0 && segments[index].tick > tick) index--
    const segment = segments[index]
    return segment.ms + ((tick - segment.tick) * 60000) / (segment.tempo * TICKS_PER_QUARTER)
  }
}

/** A bass, as opposed to a guitar with extra low strings: everything is tuned low. */
function isBass(tuning: number[]): boolean {
  return tuning.length > 0 && Math.min(...tuning) < 32 && Math.max(...tuning) < 55
}

/** The note that was actually struck: for a tied note, the one the tie started from. */
function struckNote(note: Note): Note {
  let first = note
  while (first.isTieDestination && first.tieOrigin) first = first.tieOrigin
  return first
}

/** Whether a note is fretted (or left open) by the fretting hand at all. */
function isFretted(note: Note, strings: number): boolean {
  if (note.isDead || note.isTieDestination || note.fret < 0) return false
  if (note.string < 1 || note.string > strings) return false
  // Tapped notes belong to the picking hand.
  return !note.beat.tap || note.isLeftHandTapped
}

/**
 * The notes of a track as the recommender wants them: grouped by the moment
 * they start, with how long each stays down. Null for drums and the like.
 */
export function trackEvents(track: Track): { events: FingerEvent[]; notes: Map<number, Note> } | null {
  const staff = track.staves[0]
  if (!staff || staff.isPercussion || staff.tuning.length === 0) return null
  const strings = staff.tuning.length
  const timeAt = timeMap(track.score)
  const byTick = new Map<number, FingerEvent>()
  const source = new Map<number, Note>()
  /** Whether every note starting at a tick is marked "let ring". */
  const ringing = new Map<number, boolean>()
  /** When each string is next struck, dead notes included. */
  const struck: number[][] = Array.from({ length: strings + 1 }, () => [])
  const letRing = new Set<number>()

  for (const bar of staff.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        if (beat.isRest) continue
        const tick = beat.absolutePlaybackStart
        for (const note of beat.notes) {
          if (note.isTieDestination || note.string < 1 || note.string > strings) continue
          struck[note.string].push(tick)
          if (!isFretted(note, strings)) continue
          let end = tick + beat.playbackDuration
          for (let tied = note.tieDestination; tied; tied = tied.tieDestination) {
            end = Math.max(end, tied.beat.absolutePlaybackStart + tied.beat.playbackDuration)
          }
          const entry: FingerNote = { id: note.id, string: note.string, fret: note.fret, until: end, firm: true }
          if (note.hasBend) entry.bend = true
          const finger = note.leftHandFinger as number
          if (finger >= 1 && finger <= 4) entry.fixed = finger as Finger
          source.set(note.id, note)
          // A note the file gives to the thumb is not the fingers' business.
          if (finger === 0) continue
          if (note.slideOrigin && note.slideOrigin.slideOutType !== alphaTab.model.SlideOutType.None) {
            entry.slideFrom = struckNote(note.slideOrigin).id
          }
          if (note.hammerPullOrigin) entry.legatoFrom = struckNote(note.hammerPullOrigin).id
          if (note.isLetRing) letRing.add(note.id)
          let event = byTick.get(tick)
          if (!event) {
            event = { tick, ms: timeAt(tick), notes: [] }
            byTick.set(tick, event)
          }
          event.notes.push(entry)
          ringing.set(tick, (ringing.get(tick) ?? true) && note.isLetRing)
        }
      }
    }
  }

  const events = [...byTick.values()].sort((a, b) => a.tick - b.tick)
  for (const ticks of struck) ticks.sort((a, b) => a - b)
  /** For each event, the tick at which the ringing it belongs to stops: the next event that is not marked. */
  const ringEnds = new Array<number>(events.length)
  let stop = Infinity
  for (let i = events.length - 1; i >= 0; i--) {
    ringEnds[i] = stop
    if (!ringing.get(events[i].tick)) stop = events[i].tick
  }
  events.forEach((event, index) => {
    for (const note of event.notes) {
      if (letRing.has(note.id)) {
        const ring = Math.min(ringEnds[index], event.tick + LONGEST_RING)
        if (ring > note.until) {
          note.until = ring
          note.firm = false
        }
      }
      // A string struck again gives up the note it was holding.
      const next = struck[note.string].find((tick) => tick > event.tick)
      if (next !== undefined && next < note.until) note.until = next
    }
  })
  return { events, notes: source }
}

/** A number that changes when anything the suggestions depend on changes. */
function signature(events: FingerEvent[], notes: Map<number, Note>): number {
  let hash = 2166136261
  const mix = (value: number) => {
    hash = Math.imul(hash ^ (value | 0), 16777619)
  }
  for (const event of events) {
    mix(event.tick)
    mix(Math.round(event.ms))
    for (const note of event.notes) {
      mix(note.id)
      mix(note.string * 64 + note.fret)
      mix(note.until)
      mix((note.firm ? 1 : 0) + (note.bend ? 2 : 0) + (note.fixed ?? 0) * 4)
      mix(note.slideFrom ?? -1)
      mix(note.legatoFrom ?? -1)
    }
  }
  // Thumb notes are not in the events but are in the result.
  mix(notes.size)
  return hash
}

/** The last result per track, kept while the track's notes stay as they were. */
const remembered = new WeakMap<Track, { signature: number; setup: string; fingerings: Fingerings }>()

/**
 * Fingerings for every note of a track: the file's own where it has them,
 * suggestions elsewhere. Asking again for an unchanged track is cheap.
 */
export function trackFingerings(track: Track): Fingerings {
  const fingerings: Fingerings = new Map()
  const prepared = trackEvents(track)
  if (!prepared) return fingerings
  const key = signature(prepared.events, prepared.notes)
  const before = remembered.get(track)
  // Capo and tuning change the answer without changing the notes.
  const setup = `${track.staves[0].capo}:${track.staves[0].tuning.join(',')}`
  if (before && before.signature === key && before.setup === setup) return before.fingerings
  const staff = track.staves[0]
  const capo = staff.capo
  const suggestions = recommend(prepared.events, { capo, bass: isBass(staff.tuning) })
  for (const [id, note] of prepared.notes) {
    const suggestion = suggestions.get(id)
    const written = note.leftHandFinger as number
    const position = suggestion ? suggestion.position + capo : null
    if (written === 0) fingerings.set(id, { finger: 'T', source: 'file', position })
    else if (written >= 1 && written <= 4) fingerings.set(id, { finger: written as Finger, source: 'file', position })
    else if (suggestion && note.fret > 0) fingerings.set(id, { finger: suggestion.finger, source: 'suggested', position })
    else continue
    // A tied note is the same finger still held down.
    const fingering = fingerings.get(id)!
    for (let tied = note.tieDestination; tied; tied = tied.tieDestination) fingerings.set(tied.id, fingering)
  }
  remembered.set(track, { signature: key, setup, fingerings })
  return fingerings
}
