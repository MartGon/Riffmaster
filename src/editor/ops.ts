import * as alphaTab from '@coderline/alphatab'
import { barTicks, fillValues, type Rhythm, rhythmTicks } from './duration'
import type { Cursor, Edit, Touch } from './history'
import { deepCopy, type JsMap, list, type ScoreJs } from './tree'

type Score = alphaTab.model.Score
type Beat = alphaTab.model.Beat
type Note = alphaTab.model.Note
type Bar = alphaTab.model.Bar
const model = alphaTab.model

/** Highest fret the editor accepts, and that notes are moved to. */
export const MAX_FRET = 24

export function staffOf(score: Score, track: number): alphaTab.model.Staff {
  return score.tracks[track].staves[0]
}

export function beatAt(score: Score, cursor: Cursor): Beat | undefined {
  return staffOf(score, cursor.track)?.bars[cursor.bar]?.voices[0]?.beats[cursor.beat]
}

export function noteAt(score: Score, cursor: Cursor): Note | undefined {
  return beatAt(score, cursor)?.notes.find((note) => note.string === cursor.string)
}

/** Whether a track can be edited: it must have strings and tablature. */
export function isEditableTrack(track: alphaTab.model.Track | undefined): boolean {
  const staff = track?.staves[0]
  return !!staff && !staff.isPercussion && staff.tuning.length > 0
}

export function beatRhythm(beat: Beat): Rhythm {
  const value = [1, 2, 4, 8, 16, 32, 64].includes(beat.duration) ? beat.duration : 4
  const tupled = beat.tupletNumerator > 0 && beat.tupletDenominator > 0
  const triplet = beat.tupletNumerator === 3 && beat.tupletDenominator === 2
  return {
    value: value as Rhythm['value'],
    dots: beat.dots,
    triplet,
    tuplet: tupled && !triplet ? [beat.tupletNumerator, beat.tupletDenominator] : undefined,
  }
}

function setRhythm(beat: Beat, rhythm: Rhythm): void {
  beat.duration = rhythm.value as unknown as alphaTab.model.Duration
  beat.dots = rhythm.dots
  const [numerator, denominator] = rhythm.tuplet ?? (rhythm.triplet ? [3, 2] : [-1, -1])
  beat.tupletNumerator = numerator
  beat.tupletDenominator = denominator
}

/**
 * Takes the tie off notes held over from `notes`, which are about to go.
 * Otherwise alphaTab would tie them to an earlier note on the same string
 * and give them that note's fret.
 */
function untieFrom(notes: Iterable<Note>): void {
  for (const note of notes) {
    if (note.tieDestination) note.tieDestination.isTieDestination = false
  }
}

/** Length of a beat in ticks; an empty placeholder beat and a grace note take no time in the bar. */
function beatTicks(beat: Beat): number {
  if (beat.isEmpty || beat.graceType !== alphaTab.model.GraceType.None) return 0
  let ticks = rhythmTicks({ value: beat.duration as unknown as Rhythm['value'], dots: beat.dots, triplet: false })
  if (beat.tupletNumerator > 0 && beat.tupletDenominator > 0) {
    ticks = (ticks * beat.tupletDenominator) / beat.tupletNumerator
  }
  return ticks
}

/** How much of the bar the first voice fills, and how long the bar should be. */
export function barFill(score: Score, track: number, bar: number): { used: number; length: number } {
  const masterBar = score.masterBars[bar]
  const beats = staffOf(score, track).bars[bar]?.voices[0]?.beats ?? []
  return {
    // Tuplets such as 9:8 add up to a whole bar only up to rounding.
    used: Math.round(beats.reduce((sum, beat) => sum + beatTicks(beat), 0)),
    length: barTicks(masterBar.timeSignatureNumerator, masterBar.timeSignatureDenominator),
  }
}

/**
 * The bar and its neighbours: a change to one bar can change ties up to three
 * bars later, and slides and hammer-ons into the bar before.
 */
function aroundBar(score: Score, cursor: Cursor): Touch[] {
  const count = score.masterBars.length
  const touches: Touch[] = []
  for (let bar = cursor.bar - 1; bar <= cursor.bar + 3; bar++) {
    if (bar >= 0 && bar < count) touches.push({ kind: 'bar', track: cursor.track, bar })
  }
  return touches
}

function newBeat(rhythm: Rhythm): Beat {
  const beat = new model.Beat()
  setRhythm(beat, rhythm)
  return beat
}

function emptyBeat(): Beat {
  const beat = new model.Beat()
  beat.isEmpty = true
  beat.duration = 4 as unknown as alphaTab.model.Duration
  return beat
}

function noteEdit(
  score: Score,
  cursor: Cursor,
  label: string,
  change: (beat: Beat) => void,
): Edit | null {
  if (!beatAt(score, cursor)) return null
  return {
    label,
    touches: aroundBar(score, cursor),
    apply: (song) => {
      change(beatAt(song, cursor)!)
      return cursor
    },
  }
}

/** Puts a fret on the cursor's string. An empty beat becomes a note of the chosen length. */
export function setFret(score: Score, cursor: Cursor, fret: number, rhythm: Rhythm): Edit | null {
  if (fret < 0 || fret > MAX_FRET) return null
  return noteEdit(score, cursor, `Fret ${fret}`, (beat) => {
    if (beat.isEmpty) {
      beat.isEmpty = false
      setRhythm(beat, rhythm)
    }
    const existing = beat.notes.find((note) => note.string === cursor.string)
    if (existing) {
      existing.fret = fret
      existing.isTieDestination = false
      existing.isDead = false
      return
    }
    const note = new model.Note()
    note.string = cursor.string
    note.fret = fret
    beat.addNote(note)
  })
}

/** Removes the note on the cursor's string; a beat left without notes becomes a rest. */
export function deleteNote(score: Score, cursor: Cursor): Edit | null {
  const note = noteAt(score, cursor)
  if (!note) return null
  return noteEdit(score, cursor, 'Delete note', (beat) => {
    const target = beat.notes.find((n) => n.string === cursor.string)
    if (!target) return
    untieFrom([target])
    beat.removeNote(target)
  })
}

/** Turns the beat into a rest of the same length. */
export function makeRest(score: Score, cursor: Cursor): Edit | null {
  const beat = beatAt(score, cursor)
  if (!beat || (beat.notes.length === 0 && !beat.isEmpty)) return null
  return noteEdit(score, cursor, 'Rest', (target) => {
    untieFrom(target.notes)
    for (const note of [...target.notes]) target.removeNote(note)
    target.isEmpty = false
  })
}

export function setBeatRhythm(score: Score, cursor: Cursor, rhythm: Rhythm): Edit | null {
  const beat = beatAt(score, cursor)
  if (!beat) return null
  const current = beatRhythm(beat)
  if (!beat.isEmpty && current.value === rhythm.value && current.dots === rhythm.dots && current.triplet === rhythm.triplet && String(current.tuplet) === String(rhythm.tuplet)) {
    return null
  }
  return noteEdit(score, cursor, 'Note length', (target) => {
    target.isEmpty = false
    setRhythm(target, rhythm)
  })
}

export type NoteFlag =
  | 'hammer'
  | 'slide'
  | 'bend'
  | 'vibrato'
  | 'dead'
  | 'ghost'
  | 'palmMute'
  | 'letRing'
  | 'tie'
  | 'accent'

export const FLAG_LABELS: Record<NoteFlag, string> = {
  hammer: 'Hammer-on / pull-off',
  slide: 'Slide',
  bend: 'Bend',
  vibrato: 'Vibrato',
  dead: 'Dead note',
  ghost: 'Ghost note',
  palmMute: 'Palm mute',
  letRing: 'Let ring',
  tie: 'Tie',
  accent: 'Accent',
}

/** Bend amounts the bend button steps through, in quarter tones. */
const BEND_STEPS = [0, 2, 4]

function bendAmount(note: Note): number {
  return note.hasBend ? Math.max(...(note.bendPoints ?? []).map((point) => point.value)) : 0
}

export function flagState(note: Note | undefined, flag: NoteFlag): boolean {
  if (!note) return false
  switch (flag) {
    case 'hammer':
      return note.isHammerPullOrigin
    case 'slide':
      return note.slideOutType !== alphaTab.model.SlideOutType.None
    case 'bend':
      return note.hasBend
    case 'vibrato':
      return note.vibrato !== alphaTab.model.VibratoType.None
    case 'dead':
      return note.isDead
    case 'ghost':
      return note.isGhost
    case 'palmMute':
      return note.isPalmMute
    case 'letRing':
      return note.isLetRing
    case 'tie':
      return note.isTieDestination
    case 'accent':
      return note.accentuated !== alphaTab.model.AccentuationType.None
  }
}

/** Describes a note's bend for the status line, e.g. "full bend". */
export function bendText(note: Note): string {
  const amount = bendAmount(note)
  if (amount === 4) return 'full bend'
  if (amount === 2) return '½ bend'
  return `bend ${amount / 4}`
}

/**
 * Why a technique cannot be switched on for the note under the cursor, or
 * null if it can. Hammer-ons, slides and ties connect two notes, and alphaTab
 * drops them when the other note is missing.
 */
export function flagProblem(score: Score, cursor: Cursor, flag: NoteFlag): string | null {
  const note = noteAt(score, cursor)
  if (!note || flagState(note, flag)) return null
  const Note = alphaTab.model.Note
  if (flag === 'hammer' && !Note.findHammerPullDestination(note)) {
    return 'A hammer-on or pull-off needs a following note on the same string. Write that note first.'
  }
  if (flag === 'slide' && !Note.nextNoteOnSameLine(note)) {
    return 'A slide needs a following note on the same string. Write that note first.'
  }
  if (flag === 'tie' && !Note.findTieOrigin(note)) {
    return 'A tie needs an earlier note on the same string to hold over.'
  }
  return null
}

/** Switches a technique on or off for the note under the cursor. Bends step through ½, full and off. */
export function toggleFlag(score: Score, cursor: Cursor, flag: NoteFlag): Edit | null {
  if (!noteAt(score, cursor)) return null
  return noteEdit(score, cursor, FLAG_LABELS[flag], (beat) => {
    const note = beat.notes.find((n) => n.string === cursor.string)!
    const on = !flagState(note, flag)
    switch (flag) {
      case 'hammer':
        note.isHammerPullOrigin = on
        break
      case 'slide':
        note.slideOutType = on ? alphaTab.model.SlideOutType.Shift : alphaTab.model.SlideOutType.None
        break
      case 'bend': {
        const index = BEND_STEPS.indexOf(bendAmount(note))
        const next = BEND_STEPS[(index + 1) % BEND_STEPS.length]
        note.bendPoints = null
        note.bendType = alphaTab.model.BendType.None
        if (next > 0) {
          note.addBendPoint(new model.BendPoint(0, 0))
          note.addBendPoint(new model.BendPoint(15, next))
          note.addBendPoint(new model.BendPoint(60, next))
          note.bendType = alphaTab.model.BendType.Bend
        }
        break
      }
      case 'vibrato':
        note.vibrato = on ? alphaTab.model.VibratoType.Slight : alphaTab.model.VibratoType.None
        break
      case 'dead':
        note.isDead = on
        break
      case 'ghost':
        note.isGhost = on
        break
      case 'palmMute':
        note.isPalmMute = on
        break
      case 'letRing':
        note.isLetRing = on
        break
      case 'tie':
        note.isTieDestination = on
        break
      case 'accent':
        note.accentuated = on ? alphaTab.model.AccentuationType.Normal : alphaTab.model.AccentuationType.None
        break
    }
  })
}

/** Adds a rest before the cursor's beat; the cursor moves onto it. An empty bar just gets its first beat. */
export function insertBeat(score: Score, cursor: Cursor, rhythm: Rhythm): Edit | null {
  const beat = beatAt(score, cursor)
  if (!beat) return null
  if (beat.isEmpty) return setBeatRhythm(score, cursor, rhythm)
  return {
    label: 'Insert beat',
    touches: aroundBar(score, cursor),
    apply: (song) => {
      const voice = staffOf(song, cursor.track).bars[cursor.bar].voices[0]
      voice.beats.splice(cursor.beat, 0, newBeat(rhythm))
      return cursor
    },
  }
}

/** Adds a rest after the bar's last beat and moves the cursor there. */
export function appendBeat(score: Score, cursor: Cursor, rhythm: Rhythm): Edit | null {
  const voice = staffOf(score, cursor.track)?.bars[cursor.bar]?.voices[0]
  if (!voice) return null
  const at = voice.beats.length
  return {
    label: 'Add beat',
    touches: aroundBar(score, cursor),
    apply: (song) => {
      staffOf(song, cursor.track).bars[cursor.bar].voices[0].beats.push(newBeat(rhythm))
      return { ...cursor, beat: at }
    },
  }
}

/** Removes the cursor's beat. A bar's only beat is emptied instead. */
export function deleteBeat(score: Score, cursor: Cursor): Edit | null {
  const voice = staffOf(score, cursor.track)?.bars[cursor.bar]?.voices[0]
  const beat = voice?.beats[cursor.beat]
  if (!voice || !beat) return null
  if (voice.beats.length === 1 && beat.isEmpty) return null
  const last = voice.beats.length === 1
  return {
    label: 'Delete beat',
    touches: aroundBar(score, cursor),
    apply: (song) => {
      const beats = staffOf(song, cursor.track).bars[cursor.bar].voices[0].beats
      untieFrom(beats[cursor.beat].notes)
      beats.splice(cursor.beat, 1)
      if (last) beats.push(emptyBeat())
      return { ...cursor, beat: Math.max(0, Math.min(cursor.beat, beats.length - 1)) }
    },
  }
}

/** An empty bar shaped like `like` (clef, key and number of voices). */
function emptyBar(like: Bar | undefined): Bar {
  const bar = new model.Bar()
  if (like) {
    bar.clef = like.clef
    bar.clefOttava = like.clefOttava
    bar.keySignature = like.keySignature
    bar.keySignatureType = like.keySignatureType
  }
  const voices = Math.max(1, like?.voices.length ?? 1)
  for (let v = 0; v < voices; v++) {
    const voice = new model.Voice()
    voice.addBeat(emptyBeat())
    bar.addVoice(voice)
  }
  return bar
}

function masterBarLike(like: alphaTab.model.MasterBar | undefined): alphaTab.model.MasterBar {
  const masterBar = new model.MasterBar()
  if (like) {
    masterBar.timeSignatureNumerator = like.timeSignatureNumerator
    masterBar.timeSignatureDenominator = like.timeSignatureDenominator
    masterBar.timeSignatureCommon = like.timeSignatureCommon
    masterBar.tripletFeel = like.tripletFeel
  }
  return masterBar
}

/** Adds empty bars at `at` in every track, shaped like the bar before them (or after, at the start). */
export function insertBars(score: Score, at: number, count: number, cursor: Cursor): Edit | null {
  if (count < 1 || at < 0 || at > score.masterBars.length) return null
  return {
    label: count === 1 ? 'Insert bar' : `Insert ${count} bars`,
    touches: [{ kind: 'insertBars', at, count }],
    apply: (song) => {
      const likeIndex = at > 0 ? at - 1 : 0
      const added = Array.from({ length: count }, () => masterBarLike(song.masterBars[likeIndex]))
      // The song's tempo is set on its first bar, so new bars at the start take it over.
      if (at === 0) {
        added[0].tempoAutomations = song.masterBars[0].tempoAutomations.filter((a) => a.ratioPosition === 0)
        song.masterBars[0].tempoAutomations = song.masterBars[0].tempoAutomations.filter((a) => a.ratioPosition !== 0)
      }
      song.masterBars.splice(at, 0, ...added)
      for (const track of song.tracks) {
        for (const staff of track.staves) {
          const like = staff.bars[likeIndex]
          staff.bars.splice(at, 0, ...Array.from({ length: count }, () => emptyBar(like)))
        }
      }
      return { ...cursor, bar: at, beat: 0 }
    },
  }
}

export function deleteBars(score: Score, at: number, count: number, cursor: Cursor): Edit | null {
  const total = score.masterBars.length
  if (count < 1 || at < 0 || at + count > total || count >= total) return null
  return {
    label: count === 1 ? 'Delete bar' : `Delete ${count} bars`,
    touches: [{ kind: 'deleteBars', at, count }],
    apply: (song) => {
      // Notes after the gap that were tied to deleted notes lose the tie.
      for (const track of song.tracks) {
        for (const staff of track.staves) {
          for (const bar of staff.bars.slice(at, at + count)) {
            for (const voice of bar.voices) for (const beat of voice.beats) untieFrom(beat.notes)
          }
        }
      }
      // The tempo in effect after the deleted bars must survive, especially
      // when the first bar, which sets the song's tempo, is deleted.
      const after = song.masterBars[at + count]
      if (after && !after.tempoAutomations.some((a) => a.ratioPosition === 0)) {
        let tempo: alphaTab.model.Automation | undefined
        for (let index = at + count - 1; index >= 0 && !tempo; index--) {
          const automations = song.masterBars[index].tempoAutomations
          tempo = automations[automations.length - 1]
        }
        if (tempo && at === 0) {
          after.tempoAutomations.unshift(model.Automation.buildTempoAutomation(false, 0, tempo.value, 2))
        } else if (tempo && at > 0) {
          // Only needed if the deleted bars changed the tempo.
          let before: alphaTab.model.Automation | undefined
          for (let index = at - 1; index >= 0 && !before; index--) {
            const automations = song.masterBars[index].tempoAutomations
            before = automations[automations.length - 1]
          }
          if (before && before.value !== tempo.value) {
            after.tempoAutomations.unshift(model.Automation.buildTempoAutomation(false, 0, tempo.value, 2))
          }
        }
      }
      song.masterBars.splice(at, count)
      for (const track of song.tracks) {
        for (const staff of track.staves) staff.bars.splice(at, count)
      }
      return { ...cursor, bar: Math.min(at, total - count - 1), beat: 0 }
    },
  }
}

/**
 * Sets the time signature from `bar` on: that bar and the following ones that
 * had the same signature, up to the next change.
 */
export function setTimeSignature(
  score: Score,
  bar: number,
  numerator: number,
  denominator: number,
  cursor: Cursor,
): Edit | null {
  const first = score.masterBars[bar]
  if (!first) return null
  if (first.timeSignatureNumerator === numerator && first.timeSignatureDenominator === denominator) return null
  const oldNumerator = first.timeSignatureNumerator
  const oldDenominator = first.timeSignatureDenominator
  let last = bar
  while (
    last + 1 < score.masterBars.length &&
    score.masterBars[last + 1].timeSignatureNumerator === oldNumerator &&
    score.masterBars[last + 1].timeSignatureDenominator === oldDenominator
  ) {
    last++
  }
  const touches: Touch[] = []
  for (let index = bar; index <= last; index++) touches.push({ kind: 'masterBar', bar: index })
  return {
    label: 'Time signature',
    touches,
    apply: (song) => {
      for (let index = bar; index <= last; index++) {
        const masterBar = song.masterBars[index]
        masterBar.timeSignatureNumerator = numerator
        masterBar.timeSignatureDenominator = denominator
        masterBar.timeSignatureCommon = false
      }
      return cursor
    },
  }
}

function masterBarEdit(
  score: Score,
  bar: number,
  label: string,
  cursor: Cursor,
  change: (masterBar: alphaTab.model.MasterBar) => void,
): Edit | null {
  if (!score.masterBars[bar]) return null
  return {
    label,
    touches: [{ kind: 'masterBar', bar }],
    apply: (song) => {
      change(song.masterBars[bar])
      return cursor
    },
  }
}

export function toggleRepeatStart(score: Score, bar: number, cursor: Cursor): Edit | null {
  return masterBarEdit(score, bar, 'Repeat start', cursor, (masterBar) => {
    masterBar.isRepeatStart = !masterBar.isRepeatStart
  })
}

/** Sets how often the passage ending at this bar is played; 0 removes the repeat sign. */
export function setRepeatEnd(score: Score, bar: number, times: number, cursor: Cursor): Edit | null {
  if (score.masterBars[bar]?.repeatCount === times) return null
  return masterBarEdit(score, bar, 'Repeat end', cursor, (masterBar) => {
    masterBar.repeatCount = times
  })
}

/** Names the section starting at this bar; an empty name removes the marker. */
export function setSection(score: Score, bar: number, name: string, cursor: Cursor): Edit | null {
  const text = name.trim()
  const current = score.masterBars[bar]?.section?.text ?? ''
  if (text === current) return null
  return masterBarEdit(score, bar, text ? 'Section' : 'Remove section', cursor, (masterBar) => {
    if (!text) {
      masterBar.section = null
      return
    }
    const section = new model.Section()
    section.text = text
    section.marker = ''
    masterBar.section = section
  })
}

export function setSongInfo(
  score: Score,
  info: { title: string; artist: string; tempo: number },
  cursor: Cursor,
): Edit | null {
  const tempo = Math.round(info.tempo)
  if (score.title === info.title && score.artist === info.artist && score.tempo === tempo) return null
  return {
    label: 'Song details',
    touches: [{ kind: 'songInfo' }, { kind: 'masterBar', bar: 0 }],
    apply: (song) => {
      song.title = info.title
      song.artist = info.artist
      const automations = song.masterBars[0].tempoAutomations
      const first = automations.find((automation) => automation.ratioPosition === 0)
      if (first) first.value = tempo
      else automations.unshift(model.Automation.buildTempoAutomation(false, 0, tempo, 2))
      return cursor
    },
  }
}

/** Name, tuning (highest string first, as MIDI notes) and capo of a track. The string count stays. */
export function setTrackInfo(
  score: Score,
  track: number,
  info: { name: string; tuning: number[]; capo: number },
  cursor: Cursor,
): Edit | null {
  const target = score.tracks[track]
  const staff = target?.staves[0]
  if (!target || !staff || info.tuning.length !== staff.tuning.length) return null
  const same =
    target.name === info.name &&
    staff.capo === info.capo &&
    staff.tuning.every((pitch, index) => pitch === info.tuning[index])
  if (same) return null
  return {
    label: 'Track details',
    touches: [{ kind: 'trackInfo', track }],
    apply: (song) => {
      const edited = song.tracks[track]
      edited.name = info.name
      edited.shortName = info.name.slice(0, 10)
      const tuning = new model.Tuning()
      tuning.tunings = [...info.tuning]
      const known = model.Tuning.findTuning(info.tuning)
      tuning.name = known?.name ?? ''
      tuning.isStandard = known?.isStandard ?? false
      edited.staves[0].stringTuning = tuning
      edited.staves[0].capo = info.capo
      return cursor
    },
  }
}

export interface NewTrack {
  name: string
  /** Highest string first, as MIDI notes. */
  tuning: number[]
  /** General MIDI program (sound). */
  program: number
}

/** MIDI channels in use; channel 9 is reserved for drums. */
function freeChannels(score: Score): [number, number] | null {
  const used = new Set<number>([9])
  for (const track of score.tracks) {
    used.add(track.playbackInfo.primaryChannel)
    used.add(track.playbackInfo.secondaryChannel)
  }
  const free = Array.from({ length: 16 }, (_, channel) => channel).filter((channel) => !used.has(channel))
  return free.length >= 2 ? [free[0], free[1]] : null
}

/** Adds a track at the end with empty bars. Fails when MIDI has no channels left. */
export function addTrack(score: Score, info: NewTrack, cursor: Cursor): Edit | null {
  const channels = freeChannels(score)
  if (!channels) return null
  const at = score.tracks.length
  return {
    label: 'Add track',
    touches: [{ kind: 'insertTrack', at }],
    apply: (song) => {
      const track = new model.Track()
      track.name = info.name
      track.shortName = info.name.slice(0, 10)
      track.playbackInfo.program = info.program
      track.playbackInfo.primaryChannel = channels[0]
      track.playbackInfo.secondaryChannel = channels[1]
      track.playbackInfo.volume = 15
      track.playbackInfo.balance = 8
      const staff = new model.Staff()
      const tuning = new model.Tuning()
      tuning.tunings = [...info.tuning]
      staff.stringTuning = tuning
      staff.showTablature = true
      staff.showStandardNotation = true
      for (let bar = 0; bar < song.masterBars.length; bar++) staff.bars.push(emptyBar(undefined))
      track.staves.push(staff)
      song.tracks.push(track)
      return { track: at, bar: cursor.bar, beat: 0, string: 1 }
    },
  }
}

export function deleteTrack(score: Score, track: number, cursor: Cursor): Edit | null {
  if (score.tracks.length <= 1 || !score.tracks[track]) return null
  return {
    label: 'Delete track',
    touches: [{ kind: 'deleteTrack', at: track }],
    apply: (song) => {
      song.tracks.splice(track, 1)
      const next = Math.max(0, Math.min(track, song.tracks.length - 1))
      return { ...cursor, track: next, beat: 0, string: 1 }
    },
  }
}

/** Bars copied from a track, in serialized form, with the string count they were written for. */
export interface BarClip {
  bars: JsMap[]
  strings: number
}

export function copyBars(js: ScoreJs, track: number, first: number, last: number): BarClip | null {
  const staff = list(list(js, 'tracks')[track], 'staves')[0]
  if (!staff) return null
  const bars = list(staff, 'bars').slice(first, last + 1)
  const strings = ((staff.get('stringtuning') as JsMap | undefined)?.get('tunings') as number[] | undefined)?.length ?? 0
  return bars.length > 0 ? { bars: bars.map(deepCopy), strings } : null
}

/**
 * Replaces bars of the track, starting at the cursor's bar, with copied ones.
 * Only as many bars as exist are replaced. Notes on strings the track does
 * not have are dropped.
 */
export function pasteBars(score: Score, cursor: Cursor, clip: BarClip): Edit | null {
  const staff = staffOf(score, cursor.track)
  if (!staff) return null
  const count = Math.min(clip.bars.length, staff.bars.length - cursor.bar)
  if (count < 1) return null
  const strings = staff.tuning.length
  const touches: Touch[] = []
  for (let bar = Math.max(0, cursor.bar - 1); bar <= Math.min(staff.bars.length - 1, cursor.bar + count); bar++) {
    touches.push({ kind: 'bar', track: cursor.track, bar })
  }
  return {
    label: count === 1 ? 'Paste bar' : `Paste ${count} bars`,
    touches,
    applyJs: (js) => {
      const bars = list(list(list(js, 'tracks')[cursor.track], 'staves')[0], 'bars')
      for (let index = 0; index < count; index++) {
        const bar = deepCopy(clip.bars[index])
        // Strings are counted from the lowest, so a note keeps its string
        // number when the string count differs, and is dropped when the
        // track does not have that string.
        for (const voice of list(bar, 'voices')) {
          for (const beat of list(voice, 'beats')) {
            const notes = list(beat, 'notes').filter((note) => (note.get('string') as number) <= strings)
            beat.set('notes', notes)
          }
        }
        bars[cursor.bar + index] = bar
      }
      return { ...cursor, beat: 0 }
    },
  }
}

/** The plain rests that fill what is left of the cursor's bar, for the "fill with rests" action. */
export function fillBar(score: Score, cursor: Cursor): Edit | null {
  const { used, length } = barFill(score, cursor.track, cursor.bar)
  if (used >= length) return null
  const values = fillValues(length - used)
  if (values.length === 0) return null
  return {
    label: 'Fill with rests',
    touches: aroundBar(score, cursor),
    apply: (song) => {
      const beats = staffOf(song, cursor.track).bars[cursor.bar].voices[0].beats
      const kept = beats.filter((beat) => !beat.isEmpty)
      beats.splice(0, beats.length, ...kept, ...values.map((value) => newBeat({ value, dots: 0, triplet: false })))
      return cursor
    },
  }
}
