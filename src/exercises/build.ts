import * as alphaTab from '@coderline/alphatab'
import { INSTRUMENTS, newTrack } from '../editor/newSong'

const model = alphaTab.model

/** One note of an exercise. Strings are counted from the lowest, starting at 1. */
export interface Tone {
  string: number
  fret: number
  /** The fretting finger to show, 1 being the index finger. */
  finger?: 1 | 2 | 3 | 4
  /** The next note on this string is hammered on or pulled off, not picked. */
  legato?: boolean
}

/** Notes sounded together, or a rest when there are none. */
export interface Step {
  tones: Tone[]
  /** Length in sixteenth notes: 1, 2, 4, 8 or 16. */
  length: number
  /** Name of the chord that starts here, from the sheet's chords. */
  chord?: string
  /** Strummed downwards, the notes a moment apart. */
  strum?: boolean
}

/** A written-out exercise in 4/4. */
export interface Sheet {
  title: string
  tempo: number
  steps: Step[]
  /** Chord diagrams, as the fret on each string from the lowest; -1 is a string left out. */
  chords?: Record<string, { frets: number[]; barre?: number }>
}

/** Sixteenth notes in a bar. */
const BAR = 16
const LENGTHS = [16, 8, 4, 2, 1]

/** The longest plain note that can start at `at` sixteenths into a bar and still fit. */
function longestFrom(at: number): number {
  return LENGTHS.find((length) => at % length === 0 && at + length <= BAR) ?? 1
}

/**
 * The steps split into full bars. The last note is held on where that
 * gives a plain note length, and rests fill what is left of the last bar.
 */
export function intoBars(steps: Step[]): Step[][] {
  const bars: Step[][] = [[]]
  let used = 0
  steps.forEach((step, index) => {
    if (!LENGTHS.includes(step.length)) throw new Error(`A step cannot be ${step.length} sixteenths long`)
    if (used === BAR) {
      bars.push([])
      used = 0
    }
    if (used + step.length > BAR) throw new Error('A note runs over the end of a bar')
    const last = index === steps.length - 1
    const length = last && step.tones.length > 0 ? Math.max(step.length, longestFrom(used)) : step.length
    bars[bars.length - 1].push({ ...step, length })
    used += length
  })
  while (used < BAR) {
    const length = longestFrom(used)
    bars[bars.length - 1].push({ tones: [], length })
    used += length
  }
  return bars
}

/** The exercise as a Guitar Pro file with one guitar track. */
export function buildSheet(sheet: Sheet, settings = new alphaTab.Settings()): Uint8Array {
  const bars = intoBars(sheet.steps)
  const score = new model.Score()
  score.title = sheet.title
  score.artist = 'Exercise'
  const track = newTrack(INSTRUMENTS[0])
  const staff = track.staves[0]
  const strings = staff.stringTuning.tunings.length
  for (const [name, shape] of Object.entries(sheet.chords ?? {})) {
    const chord = new model.Chord()
    chord.name = name
    // Diagrams list the highest string first.
    chord.strings = [...shape.frets].reverse()
    chord.firstFret = 1
    if (shape.barre) chord.barreFrets = [shape.barre]
    staff.addChord(name, chord)
  }
  bars.forEach((steps, index) => {
    const masterBar = new model.MasterBar()
    masterBar.timeSignatureNumerator = 4
    masterBar.timeSignatureDenominator = 4
    if (index === 0) {
      masterBar.tempoAutomations.push(model.Automation.buildTempoAutomation(false, 0, sheet.tempo, 2))
    }
    score.addMasterBar(masterBar)
    const bar = new model.Bar()
    const voice = new model.Voice()
    for (const step of steps) {
      const beat = new model.Beat()
      beat.duration = (BAR / step.length) as alphaTab.model.Duration
      if (step.chord) beat.chordId = step.chord
      if (step.strum) beat.brushType = model.BrushType.BrushDown
      for (const tone of step.tones) {
        if (tone.string < 1 || tone.string > strings || tone.fret < 0) throw new Error('A note is off the fretboard')
        const note = new model.Note()
        note.string = tone.string
        note.fret = tone.fret
        if (tone.finger) note.leftHandFinger = tone.finger as alphaTab.model.Fingers
        if (tone.legato) note.isHammerPullOrigin = true
        beat.addNote(note)
      }
      voice.addBeat(beat)
    }
    bar.addVoice(voice)
    staff.addBar(bar)
  })
  score.addTrack(track)
  score.finish(settings)
  return new alphaTab.exporter.Gp7Exporter().export(score, settings)
}
