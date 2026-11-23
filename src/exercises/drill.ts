import * as alphaTab from '@coderline/alphatab'
import { deepCopy, type JsMap, list, rebuild, serialize } from '../editor/tree'

type Score = alphaTab.model.Score
type Bar = alphaTab.model.Bar
type Beat = alphaTab.model.Beat

const model = alphaTab.model

/** A longer passage is better split up first: a drill of it would run for many minutes. */
export const MAX_DRILL_BARS = 8

const SLOW_TEMPO = 0.6
const CHUNK_TEMPO = 0.75
const VARIATION_TEMPO = 0.8
/** Passages this short are split at the half bar, and each chunk is played twice. */
const SHORT_PASSAGE_BARS = 2
const MAX_FRET = 24
/** Moving a line one string over keeps its intervals by moving it this many semitones. */
const STRING_INTERVAL = 5
const EIGHTH = 8
const SIXTEENTH = 16
const QUARTER_TICKS = 960

export interface DrillChoices {
  /** The passage at a slow tempo. */
  slow: boolean
  /** Short pieces on their own, then each joined to the next. */
  chunks: boolean
  /** Even notes played long-short and short-long. */
  rhythms: boolean
  /** The same line moved to the neighbouring strings. */
  strings: boolean
}

export interface DrillOptions {
  /** Why no drill can be made of these bars, or null when one can. */
  problem: string | null
  /** The passage has even eighths or sixteenths to vary. */
  rhythms: boolean
  /** The line fits one string higher or lower. */
  strings: boolean
  /** A pick-up bar in the selection is left out of the drill. */
  leftOutPickup: boolean
}

export interface BuiltDrill {
  title: string
  /** The same for the same passage and choices, so a drill is found in the library again. */
  fileName: string
  data: Uint8Array
  /** Names of the parts of the drill, in order. */
  sections: string[]
}

type Rhythm = 'long-short' | 'short-long'

/** One bar of the source, in the form it takes in a drill. */
interface Part {
  bar: number
  /** Only the notes from this tick to before that one sound, counted from the start of the bar. */
  from?: number
  to?: number
  rhythm?: Rhythm
  shift?: 1 | -1
}

/** Bars played straight through; ties and legato do not carry from one run to the next. */
type Run = Part[]

interface Section {
  name: string
  tempo: number
  runs: Run[]
}

function firstStaff(score: Score, trackIndex: number) {
  return score.tracks.find((track) => track.index === trackIndex)?.staves[0]
}

/** Each beat's position in its bar. A grace note goes with the beat it leads into. */
function beatPositions(beats: Beat[]): number[] {
  const positions = beats.map((beat) => beat.playbackStart)
  for (let index = beats.length - 2; index >= 0; index--) {
    if (beats[index].graceType !== model.GraceType.None) positions[index] = positions[index + 1]
  }
  return positions
}

function hasNotes(bar: Bar, from = 0, to = Infinity): boolean {
  return bar.voices.some((voice) => {
    const positions = beatPositions(voice.beats)
    return voice.beats.some((beat, index) => beat.notes.length > 0 && positions[index] >= from && positions[index] < to)
  })
}

/** Pairs of neighbouring even notes, as indexes into the first voice, that can be played long-short. */
function evenPairs(bar: Bar): [number, number][] {
  if (bar.voices.filter((voice) => voice.beats.some((beat) => beat.notes.length > 0)).length !== 1) return []
  const beats = bar.voices[0].beats
  if (!beats.some((beat) => beat.notes.length > 0)) return []
  const { timeSignatureNumerator: numerator, timeSignatureDenominator: denominator } = bar.masterBar
  // Compound time, such as 6/8 or 12/16, moves in groups of three.
  const beatTicks = (QUARTER_TICKS * 4) / denominator
  const compound = denominator >= 8 && numerator > 3 && numerator % 3 === 0
  const pulse = compound ? beatTicks * 3 : Math.max(QUARTER_TICKS, beatTicks)
  const even = (beat: Beat) =>
    !beat.isRest &&
    beat.graceType === model.GraceType.None &&
    !beat.hasTuplet &&
    beat.dots === 0 &&
    ((beat.duration as number) === EIGHTH || (beat.duration as number) === SIXTEENTH) &&
    !beat.notes.some((note) => note.isTieDestination)
  const pairs: [number, number][] = []
  for (let index = 0; index + 1 < beats.length; index++) {
    const [a, b] = [beats[index], beats[index + 1]]
    if (!even(a) || !even(b) || a.duration !== b.duration) continue
    // On the grid and inside one pulse, so that the note on the beat stays on it.
    const span = a.playbackDuration * 2
    const inPulse = a.playbackStart % pulse
    if (inPulse % span !== 0 || inPulse + span > pulse) continue
    pairs.push([index, index + 1])
    index++
  }
  return pairs
}

/** Open string pitch; strings are counted from the lowest, starting at 1. */
const openString = (tunings: number[], string: number) => tunings[tunings.length - string]

/** Whether every note of the bars can move one string over with its intervals kept. */
function fitsShift(bars: Bar[], tunings: number[], shift: 1 | -1): boolean {
  return bars.every((bar) =>
    bar.voices.every((voice) =>
      voice.beats.every((beat) =>
        beat.notes.every((note) => {
          const target = note.string + shift
          if (target < 1 || target > tunings.length) return false
          if (note.harmonicType !== model.HarmonicType.None) return false
          const fret = note.fret + openString(tunings, note.string) + shift * STRING_INTERVAL - openString(tunings, target)
          return fret >= 0 && fret <= MAX_FRET
        }),
      ),
    ),
  )
}

function passageBars(score: Score, trackIndex: number, first: number, last: number): number[] {
  const staff = firstStaff(score, trackIndex)
  const indexes: number[] = []
  // A pick-up bar is shorter than its time signature and only makes sense at the start of a song.
  for (let bar = first; bar <= last; bar++) if (staff?.bars[bar] && !score.masterBars[bar].isAnacrusis) indexes.push(bar)
  return indexes
}

/** What can be made of the bars `first` to `last` of a track. */
export function drillOptions(score: Score, trackIndex: number, first: number, last: number): DrillOptions {
  const none = (problem: string): DrillOptions => ({ problem, rhythms: false, strings: false, leftOutPickup: false })
  const staff = firstStaff(score, trackIndex)
  if (!staff || staff.isPercussion || staff.stringTuning.tunings.length === 0) {
    return none('Drills need a track with strings, and this one has none.')
  }
  if (last - first + 1 > MAX_DRILL_BARS) return none(`Select ${MAX_DRILL_BARS} bars or fewer to make a drill.`)
  const indexes = passageBars(score, trackIndex, first, last)
  if (indexes.length === 0) return none('A pick-up bar cannot be drilled on its own. Select the bar after it as well.')
  const bars = indexes.map((index) => staff.bars[index])
  if (bars.some((bar) => bar.simileMark !== model.SimileMark.None)) {
    return none('These bars repeat earlier ones with a repeat sign, so they have no notes of their own to drill.')
  }
  if (!bars.some((bar) => hasNotes(bar))) return none('These bars have no notes to drill.')
  const tunings = staff.stringTuning.tunings
  return {
    problem: null,
    rhythms: bars.some((bar) => evenPairs(bar).length > 0),
    strings: fitsShift(bars, tunings, 1) || fitsShift(bars, tunings, -1),
    leftOutPickup: indexes.length < last - first + 1,
  }
}

/** Half bars of a short passage, whole bars of a longer one; each is a list of bars with what to keep of them. */
function chunkRuns(score: Score, bars: Bar[], indexes: number[]): Run[] {
  const short = indexes.length <= SHORT_PASSAGE_BARS
  const units: Part[] = indexes.flatMap((index, position) => {
    if (!short) return hasNotes(bars[position]) ? [{ bar: index }] : []
    const length = score.masterBars[index].calculateDuration()
    const half = Math.floor(length / 2)
    return [
      { bar: index, from: 0, to: half },
      { bar: index, from: half, to: Infinity },
    ].filter((unit) => hasNotes(bars[position], unit.from, unit.to))
  })
  /** Two chunks as one run: one bar when they share it, otherwise each in its own. */
  const joined = (a: Part, b: Part): Run => {
    if (a.bar === b.bar) return [{ bar: a.bar, from: a.from, to: b.to }]
    return [a, b]
  }
  const runs: Run[] = []
  const times = short ? 2 : 1
  const add = (run: Run) => {
    for (let time = 0; time < times; time++) runs.push(run)
  }
  units.forEach((unit, index) => {
    add([unit])
    if (index > 0) add(joined(units[index - 1], unit))
  })
  return runs
}

function drillSections(score: Score, trackIndex: number, indexes: number[], choices: DrillChoices): Section[] {
  const staff = firstStaff(score, trackIndex)!
  const bars = indexes.map((index) => staff.bars[index])
  const tunings = staff.stringTuning.tunings
  const whole = (change: Partial<Part> = {}): Run => indexes.map((bar) => ({ bar, ...change }))
  const sections: Section[] = []
  if (choices.slow) sections.push({ name: 'Slow', tempo: SLOW_TEMPO, runs: [whole(), whole()] })
  if (choices.chunks) {
    const runs = chunkRuns(score, bars, indexes)
    if (runs.length > 0) sections.push({ name: 'Chunks', tempo: CHUNK_TEMPO, runs })
  }
  if (choices.rhythms && bars.some((bar) => evenPairs(bar).length > 0)) {
    sections.push({ name: 'Long-short', tempo: VARIATION_TEMPO, runs: [whole({ rhythm: 'long-short' })] })
    sections.push({ name: 'Short-long', tempo: VARIATION_TEMPO, runs: [whole({ rhythm: 'short-long' })] })
  }
  if (choices.strings) {
    if (fitsShift(bars, tunings, 1)) {
      sections.push({ name: 'One string up', tempo: VARIATION_TEMPO, runs: [whole({ shift: 1 })] })
    }
    if (fitsShift(bars, tunings, -1)) {
      sections.push({ name: 'One string down', tempo: VARIATION_TEMPO, runs: [whole({ shift: -1 })] })
    }
  }
  sections.push({ name: 'Full tempo', tempo: 1, runs: [whole(), whole()] })
  return sections
}

/**
 * A Guitar Pro file holds a bend as a start, one middle value and an end. A
 * curve with more is cut down to its ends and the point furthest from them,
 * so that a bend keeps its peak when the drill is saved.
 */
function simplifyCurve(owner: JsMap, key: string): void {
  const points = owner.get(key)
  if (!Array.isArray(points) || points.length <= 3) return
  const curve = points as JsMap[]
  const value = (point: JsMap) => point.get('value') as number
  if (curve.length === 4 && value(curve[1]) === value(curve[2])) return
  const [start, end] = [curve[0], curve[curve.length - 1]]
  const level = (value(start) + value(end)) / 2
  const peak = curve.slice(1, -1).reduce((best, point) => (Math.abs(value(point) - level) > Math.abs(value(best) - level) ? point : best))
  owner.set(key, [start, peak, end])
}

/** A copy of a serialized bar in the form a part asks for. */
function renderBar(barJs: JsMap, bar: Bar, part: Part, tunings: number[]): JsMap {
  const copy = deepCopy(barJs)
  copy.delete('barlineleft')
  copy.delete('barlineright')
  copy.delete('displaywidth')
  copy.delete('displayscale')
  const from = part.from ?? 0
  const to = part.to ?? Infinity
  list(copy, 'voices').forEach((voiceJs, voiceIndex) => {
    const source = bar.voices[voiceIndex].beats
    const positions = beatPositions(source)
    const beats = list(voiceJs, 'beats')
    beats.forEach((beatJs, index) => {
      beatJs.set('automations', [])
      beatJs.delete('text')
      beatJs.delete('lyrics')
      simplifyCurve(beatJs, 'whammybarpoints')
      for (const noteJs of list(beatJs, 'notes')) simplifyCurve(noteJs, 'bendpoints')
      if (positions[index] < from || positions[index] >= to) {
        beatJs.set('notes', [])
        beatJs.delete('chordid')
        beatJs.delete('whammybarpoints')
      }
      if (part.shift) {
        // The same shape a string over is another chord.
        beatJs.delete('chordid')
        for (const noteJs of list(beatJs, 'notes')) {
          const string = noteJs.get('string') as number
          const target = string + part.shift
          const fret = noteJs.get('fret') as number
          noteJs.set('string', target)
          // A trill is written as the pitch it goes to, which moves with the line.
          const trill = noteJs.get('trillvalue') as number
          if (trill >= 0) noteJs.set('trillvalue', trill + part.shift * STRING_INTERVAL)
          noteJs.set('fret', fret + openString(tunings, string) + part.shift * STRING_INTERVAL - openString(tunings, target))
        }
      }
    })
    if (part.rhythm && voiceIndex === 0) {
      for (const [a, b] of evenPairs(bar)) {
        const [long, short] = part.rhythm === 'long-short' ? [beats[a], beats[b]] : [beats[b], beats[a]]
        const duration = long.get('duration') as number
        long.set('dots', 1)
        short.set('duration', duration * 2)
        for (const beat of [long, short]) {
          beat.delete('overridedisplayduration')
          beat.delete('displayduration')
          beat.delete('playbackduration')
        }
      }
    }
    // A grace note whose beat was silenced has nothing to lead into, and no length to rest for.
    voiceJs.set(
      'beats',
      beats.filter((beatJs, index) => source[index].graceType === model.GraceType.None || list(beatJs, 'notes').length > 0),
    )
  })
  return copy
}

const sameString = (beat: JsMap | undefined, string: unknown) =>
  !!beat && list(beat, 'notes').some((note) => note.get('string') === string)

/** Ties, legato and slides that lost the note at their other end become plain notes. */
function repairLinks(barsOfRun: JsMap[]): void {
  const voices = Math.max(...barsOfRun.map((bar) => list(bar, 'voices').length))
  for (let voice = 0; voice < voices; voice++) {
    const beats = barsOfRun.flatMap((bar) => (list(bar, 'voices')[voice] ? list(list(bar, 'voices')[voice], 'beats') : []))
    let previous: JsMap | undefined
    beats.forEach((beat, index) => {
      for (const note of list(beat, 'notes')) {
        const string = note.get('string')
        if (note.get('istiedestination') && !sameString(previous, string)) note.set('istiedestination', false)
        if (sameString(beats[index + 1], string)) continue
        if (note.get('ishammerpullorigin')) note.set('ishammerpullorigin', false)
        const slide = note.get('slideouttype')
        if (slide === model.SlideOutType.Shift || slide === model.SlideOutType.Legato) {
          note.set('slideouttype', model.SlideOutType.None)
        }
      }
      if ((beat.get('gracetype') as number) === model.GraceType.None) previous = beat
    })
  }
}

/** The written tempo where a bar starts. */
function tempoAt(score: Score, bar: number): number {
  let tempo = score.tempo
  for (let index = 0; index <= bar; index++) {
    for (const automation of score.masterBars[index]?.tempoAutomations ?? []) {
      if (index < bar || automation.ratioPosition === 0) tempo = automation.value
    }
  }
  return tempo
}

/** The instrument sounding where a bar starts, from the changes written before it. */
function programAt(staff: alphaTab.model.Staff, bar: number): number | null {
  let program: number | null = null
  for (let index = 0; index <= bar; index++) {
    const changes = (staff.bars[index]?.voices ?? [])
      .flatMap((voice) => voice.beats)
      .filter((beat) => index < bar || beat.playbackStart === 0)
      .sort((a, b) => a.playbackStart - b.playbackStart)
      .flatMap((beat) => beat.automations.filter((item) => item.type === model.AutomationType.Instrument))
    for (const change of changes) program = change.value
  }
  return program
}

/** A short hash of everything the drill is made from. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/** Serialized data as text, without the ids that differ each time a song is loaded. */
function stableText(value: unknown): string {
  if (value instanceof Map) {
    const entries = [...value].filter(([key]) => key !== 'id' && !String(key).endsWith('noteid'))
    return `{${entries.map(([key, item]) => `${key}:${stableText(item)}`).join(',')}}`
  }
  if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`
  return String(value)
}

/**
 * Turns a hard passage into a practice piece of its own: slowly, in chunks,
 * in other rhythms and on other strings, ending at full tempo. It keeps the
 * track's tuning and sound, and its rhythm whatever the time signature.
 */
export function buildDrill(
  score: Score,
  source: { songId: string; trackIndex: number; first: number; last: number },
  choices: DrillChoices,
  settings = new alphaTab.Settings(),
): BuiltDrill {
  const { songId, trackIndex, first, last } = source
  const options = drillOptions(score, trackIndex, first, last)
  if (options.problem) throw new Error(options.problem)
  const indexes = passageBars(score, trackIndex, first, last)
  const staff = firstStaff(score, trackIndex)!
  const tunings = staff.stringTuning.tunings
  const sections = drillSections(score, trackIndex, indexes, choices)

  const js = deepCopy(serialize(score))
  const trackPosition = score.tracks.findIndex((track) => track.index === trackIndex)
  const trackJs = list(js, 'tracks')[trackPosition]
  const staffJs = list(trackJs, 'staves')[0]
  const barsJs = list(staffJs, 'bars')
  const mastersJs = list(js, 'masterbars')
  const tempo = tempoAt(score, indexes[0])
  const program = programAt(staff, indexes[0])
  const made = fingerprint(
    stableText([
      tunings,
      staff.capo,
      tempo,
      program ?? -1,
      indexes.map((index) => mastersJs[index].get('timesignaturenumerator')),
      indexes.map((index) => mastersJs[index].get('timesignaturedenominator')),
      indexes.map((index) => barsJs[index]),
      Object.entries(choices).map(([key, on]) => `${key}=${on}`),
    ]),
  )
  if (program !== null) (trackJs.get('playbackinfo') as JsMap).set('program', program)

  const newBars: JsMap[] = []
  const newMasters: JsMap[] = []
  /** Where each section starts, in bars of the drill. */
  const starts: { bar: number; section: Section }[] = []
  for (const section of sections) {
    starts.push({ bar: newBars.length, section })
    for (const run of section.runs) {
      const rendered = run.map((part) => renderBar(barsJs[part.bar], staff.bars[part.bar], part, tunings))
      repairLinks(rendered)
      newBars.push(...rendered)
      for (const part of run) {
        const master = deepCopy(mastersJs[part.bar])
        for (const key of ['section', 'directions', 'fermata', 'start', 'displaywidth', 'displayscale', 'custombarnumber', 'custombarnumbertext']) {
          master.delete(key)
        }
        master.set('alternateendings', 0)
        master.set('isrepeatstart', false)
        master.set('repeatcount', 0)
        master.set('isdoublebar', false)
        master.set('isanacrusis', false)
        master.set('tempoautomations', [])
        newMasters.push(master)
      }
    }
  }
  staffJs.set('bars', newBars)
  list(trackJs, 'staves').splice(1)
  for (const key of ['defaultsystemslayout', 'systemslayout']) {
    trackJs.delete(key)
    js.delete(key)
  }
  js.delete('stylesheet')
  js.set('tracks', [trackJs])
  js.set('masterbars', newMasters)

  const drill = rebuild(js, settings)
  const barLabel = indexes.length === 1 ? `bar ${indexes[0] + 1}` : `bars ${indexes[0] + 1}–${indexes[indexes.length - 1] + 1}`
  const title = `${score.title || 'Untitled'}: ${barLabel} drill`
  drill.title = title
  drill.artist = 'Exercise'
  for (const key of ['album', 'subTitle', 'words', 'music', 'copyright', 'tab', 'instructions', 'notices'] as const) {
    drill[key] = ''
  }
  for (const { bar, section } of starts) {
    const marker = new model.Section()
    marker.text = section.tempo === 1 ? section.name : `${section.name} (${Math.round(section.tempo * 100)}%)`
    const master = drill.masterBars[bar]
    master.section = marker
    master.tempoAutomations = [model.Automation.buildTempoAutomation(false, 0, Math.max(20, Math.round(tempo * section.tempo)), 2)]
  }
  drill.finish(settings)
  return {
    title,
    fileName: `drill-${songId.slice(0, 8)}-${trackIndex}-${first}-${last}-${made}.gp`,
    data: new alphaTab.exporter.Gp7Exporter().export(drill, settings),
    sections: sections.map((section) => section.name),
  }
}
