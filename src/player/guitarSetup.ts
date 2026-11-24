import * as alphaTab from '@coderline/alphatab'
import { MAX_FRET } from '../editor/ops'

/**
 * How the player's guitar differs from a track as written, beyond the
 * whole-guitar tuning shift: where their capo is, and strings tuned on
 * their own (drop D). The tab is shown in frets for that guitar; the
 * sound, and what practice listens for, stay as written.
 */
export interface GuitarSetup {
  /** Fret the player's capo is on, 0 for none; missing means as written. */
  capo?: number
  /** Semitones each string is retuned by, highest string first, as in the tab's tuning; missing means none. */
  strings?: number[]
}

/** Setups by track index. */
export type GuitarSetups = Record<number, GuitarSetup>

export const MAX_CAPO = 12
/** The furthest one string is retuned, either way. */
export const MAX_STRING_SHIFT = 5

const whole = (value: unknown, min: number, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null

/** A setup as stored, checked against the track it is for; null when it changes nothing. */
export function cleanSetup(setup: unknown, stringCount: number): GuitarSetup | null {
  if (!setup || typeof setup !== 'object' || stringCount === 0) return null
  const given = setup as { capo?: unknown; strings?: unknown }
  const out: GuitarSetup = {}
  const capo = whole(given.capo, 0, MAX_CAPO)
  if (capo !== null) out.capo = capo
  if (Array.isArray(given.strings) && given.strings.length === stringCount) {
    const strings = given.strings.map((value) => whole(value, -MAX_STRING_SHIFT, MAX_STRING_SHIFT))
    if (strings.every((value) => value !== null) && strings.some((value) => value !== 0)) out.strings = strings as number[]
  }
  return out.capo === undefined && out.strings === undefined ? null : out
}

type Note = alphaTab.model.Note
type Beat = alphaTab.model.Beat

/** What a setup changed, kept so it can be put back exactly. */
export interface AppliedSetup {
  staff: alphaTab.model.Staff
  tuning: alphaTab.model.Tuning
  capo: number
  notes: { note: Note; string: number; fret: number; harmonicValue: number }[]
  beats: Beat[]
  /** Notes put on another string, as the fret they would need is not on this one. */
  moved: number
  /** Notes no string of the setup can play as written. */
  unplayable: number
}

const NATURAL_HARMONIC = 1
/**
 * Where natural harmonics are touched, and how far above the open string
 * each sounds, as alphaTab plays them (ModelUtils.harmonicValueToPitch).
 */
const HARMONICS: [number, number][] = [
  [12, 12],
  [7, 19],
  [19, 19],
  [5, 24],
  [24, 24],
  [4, 28],
  [9, 28],
  [16, 28],
]
function harmonicInterval(value: number): number {
  const known = HARMONICS.find(([at]) => Math.abs(at - value) < 0.01)
  if (known) return known[1]
  // Any other node: whatever alphaTab makes of it, worked out from the note itself.
  return Number.NaN
}

interface Place {
  string: number
  fret: number
  /** For a natural harmonic, where it is touched. */
  harmonic?: number
}

const stringed = (staff: alphaTab.model.Staff) => !staff.isPercussion && staff.tuning.length > 0

/** Index into the staff's tuning (highest first) of a note's string (1 being the lowest). */
const tuningIndex = (count: number, string: number) => count - string

/** The beat's notes by string, and its lowest and highest, which alphaTab works out once when the song loads. */
function refreshBeat(beat: Beat): void {
  beat.noteStringLookup.clear()
  beat.minStringNote = null
  beat.maxStringNote = null
  for (const note of beat.notes) {
    if (note.string >= 0) beat.noteStringLookup.set(note.string, note)
    if (!note.isVisible) continue
    if (!beat.minStringNote || note.string < beat.minStringNote.string) beat.minStringNote = note
    if (!beat.maxStringNote || note.string > beat.maxStringNote.string) beat.maxStringNote = note
  }
}

/**
 * Re-frets a track for the player's guitar. The written pitches stay: each
 * string's tuning and the capo change, and every fret with them, so the song
 * sounds and is scored as before. A note that would fall below the capo or
 * off the neck goes to another string that can play it, and a hammer-on or
 * slide moves to one string with the notes it joins.
 */
export function applySetup(track: alphaTab.model.Track, setup: GuitarSetup): AppliedSetup[] {
  const applied: AppliedSetup[] = []
  for (const staff of track.staves) {
    if (!stringed(staff)) continue
    const count = staff.tuning.length
    const written = [...staff.tuning]
    const writtenCapo = staff.capo
    const shifts = setup.strings?.length === count ? setup.strings : written.map(() => 0)
    const capo = setup.capo ?? writtenCapo
    const record: AppliedSetup = { staff, tuning: staff.stringTuning, capo: writtenCapo, notes: [], beats: [], moved: 0, unplayable: 0 }
    // Open strings with the capo, as written and on the player's guitar.
    const before = (string: number) => written[tuningIndex(count, string)] + writtenCapo
    const after = (string: number) => written[tuningIndex(count, string)] + shifts[tuningIndex(count, string)] + capo
    const fits = (fret: number) => fret >= 0 && fret <= MAX_FRET
    const natural = (note: Note) => note.harmonicType === NATURAL_HARMONIC
    const valid = (note: Note) => note.string >= 1 && note.string <= count

    /** Where a note can go on a string, with the same pitch; null where it cannot. */
    const placeOn = (note: Note, string: number): Place | null => {
      if (natural(note)) {
        const interval = harmonicInterval(note.harmonicValue)
        // An unusual node is kept on its own string, and only while that string sounds the same.
        if (Number.isNaN(interval)) return string === note.string && after(string) === before(note.string) ? { string, fret: note.fret, harmonic: note.harmonicValue } : null
        const pitch = before(note.string) + interval
        const nodes = [note.harmonicValue, ...HARMONICS.map(([at]) => at).filter((at) => at !== note.harmonicValue)]
        for (const at of nodes) {
          if (after(string) + harmonicInterval(at) !== pitch) continue
          return { string, fret: at === note.harmonicValue ? note.fret : at, harmonic: at }
        }
        return null
      }
      const fret = before(note.string) + note.fret - after(string)
      return fits(fret) ? { string, fret } : null
    }

    const placed = new Map<Note, Place>()
    const beatOf = new Map<Note, Beat>()
    const takenIn = new Map<Beat, Map<number, Note>>()
    const take = (beat: Beat, note: Note, place: Place) => {
      placed.set(note, place)
      takenIn.get(beat)?.set(place.string, note)
    }
    const unplayable = new Set<Note>()

    for (const bar of staff.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          const taken = new Map<number, Note>()
          takenIn.set(beat, taken)
          if (beat.notes.length > 0) record.beats.push(beat)
          const following: Note[] = []
          const homeless: Note[] = []
          for (const note of beat.notes) {
            if (!valid(note)) continue
            beatOf.set(note, beat)
            if (note.isDead) {
              // A muted note has no pitch to keep: it stays on its string, no lower than the capo.
              take(beat, note, { string: note.string, fret: Math.max(0, before(note.string) + note.fret - after(note.string)) })
              continue
            }
            const origin = note.isTieDestination ? note.tieOrigin : null
            const originPlace = origin ? placed.get(origin) : undefined
            if (origin && originPlace && originPlace.string !== origin.string) {
              following.push(note)
              continue
            }
            const own = placeOn(note, note.string)
            if (own && !taken.has(own.string)) take(beat, note, own)
            else homeless.push(note)
          }
          // A tied note stays with the note it continues, if its string is free here.
          for (const note of following) {
            const originPlace = placed.get(note.tieOrigin!)!
            if (!taken.has(originPlace.string)) take(beat, note, { ...originPlace })
            else homeless.push(note)
          }
          // Near the other notes of the beat, or low on the neck when there are none.
          const frets = [...taken.values()].map((note) => placed.get(note)!.fret)
          const anchor = frets.length > 0 ? frets.reduce((sum, fret) => sum + fret, 0) / frets.length : 0
          for (const note of homeless) {
            let best: Place | null = null
            for (let string = 1; string <= count; string++) {
              if (taken.has(string)) continue
              const place = placeOn(note, string)
              if (place && (!best || Math.abs(place.fret - anchor) < Math.abs(best.fret - anchor))) best = place
            }
            if (best) take(beat, note, best)
            else {
              unplayable.add(note)
              // Left on its string: a fret outside the neck keeps its pitch; a harmonic cannot.
              placed.set(note, natural(note) ? { string: note.string, fret: note.fret } : { string: note.string, fret: before(note.string) + note.fret - after(note.string) })
            }
          }
        }
      }
    }

    // A hammer-on, pull-off or slide is played on one string: when its notes
    // ended up on several, they move together to a string that has them all.
    const linked = new Map<Note, Note[]>()
    const groupOf = (note: Note): Note[] => {
      let group = linked.get(note)
      if (!group) {
        group = [note]
        linked.set(note, group)
      }
      return group
    }
    for (const note of placed.keys()) {
      const next = note.isHammerPullOrigin ? note.hammerPullDestination : note.slideTarget
      if (!next || !placed.has(next) || note.isDead || next.isDead) continue
      const a = groupOf(note)
      const b = groupOf(next)
      if (a === b) continue
      for (const member of b) {
        a.push(member)
        linked.set(member, a)
      }
    }
    for (const group of new Set(linked.values())) {
      if (group.length < 2 || group.some((note) => unplayable.has(note))) continue
      if (new Set(group.map((note) => placed.get(note)!.string)).size === 1) continue
      let best: { string: number; places: Place[]; cost: number } | null = null
      for (let string = 1; string <= count; string++) {
        const places = group.map((note) => placeOn(note, string))
        if (places.some((place) => !place)) continue
        const free = group.every((note) => {
          const holder = takenIn.get(beatOf.get(note)!)?.get(string)
          return !holder || group.includes(holder)
        })
        if (!free) continue
        const cost = group.filter((note) => note.string !== string).length
        if (!best || cost < best.cost) best = { string, places: places as Place[], cost }
      }
      if (!best) continue
      group.forEach((note, i) => {
        const taken = takenIn.get(beatOf.get(note)!)!
        const old = placed.get(note)!
        if (taken.get(old.string) === note) taken.delete(old.string)
        take(beatOf.get(note)!, note, best.places[i])
      })
    }

    for (const [note, place] of placed) {
      record.notes.push({ note, string: note.string, fret: note.fret, harmonicValue: note.harmonicValue })
      if (!note.isDead && !unplayable.has(note) && place.string !== note.string) record.moved++
    }
    record.unplayable = unplayable.size

    const tunings = written.map((midi, i) => midi + shifts[i])
    if (shifts.some((shift) => shift !== 0)) {
      // Named again, so the score does not call drop D standard tuning.
      staff.stringTuning = alphaTab.model.Tuning.findTuning(tunings) ?? new alphaTab.model.Tuning('', tunings, false)
    }
    staff.capo = capo
    for (const [note, place] of placed) {
      note.string = place.string
      note.fret = place.fret
      if (place.harmonic !== undefined) note.harmonicValue = place.harmonic
    }
    for (const beat of record.beats) refreshBeat(beat)
    applied.push(record)
  }
  return applied
}

/** Puts a track back as written. */
export function undoSetup(applied: AppliedSetup[]): void {
  for (const record of applied) {
    record.staff.stringTuning = record.tuning
    record.staff.capo = record.capo
    for (const { note, string, fret, harmonicValue } of record.notes) {
      note.string = string
      note.fret = fret
      note.harmonicValue = harmonicValue
    }
    for (const beat of record.beats) refreshBeat(beat)
  }
}

/** The track's tuning and capo as written, before any setup. */
export function writtenOf(applied: AppliedSetup[] | undefined, staff: alphaTab.model.Staff | undefined): { tuning: number[]; capo: number } {
  const record = applied?.[0]
  if (record) return { tuning: [...record.tuning.tunings], capo: record.capo }
  return { tuning: staff && stringed(staff) ? [...staff.tuning] : [], capo: staff?.capo ?? 0 }
}
