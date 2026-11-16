import * as alphaTab from '@coderline/alphatab'

const model = alphaTab.model

export interface Instrument {
  id: string
  label: string
  /** Open strings, highest first, as MIDI notes. */
  tuning: number[]
  /** General MIDI program. */
  program: number
}

/** Instruments a new tab or track can start with. */
export const INSTRUMENTS: Instrument[] = [
  { id: 'guitar6', label: 'Guitar, 6 strings', tuning: [64, 59, 55, 50, 45, 40], program: 25 },
  { id: 'electric6', label: 'Electric guitar, 6 strings', tuning: [64, 59, 55, 50, 45, 40], program: 29 },
  { id: 'guitar7', label: 'Guitar, 7 strings', tuning: [64, 59, 55, 50, 45, 40, 35], program: 29 },
  { id: 'bass4', label: 'Bass, 4 strings', tuning: [43, 38, 33, 28], program: 33 },
  { id: 'bass5', label: 'Bass, 5 strings', tuning: [43, 38, 33, 28, 23], program: 33 },
]

export interface NewSongInput {
  title: string
  artist: string
  instrument: Instrument
  tempo: number
  numerator: number
  denominator: number
  bars: number
}

/** A track with one tablature staff and no bars yet. */
export function newTrack(instrument: Instrument): alphaTab.model.Track {
  const track = new model.Track()
  track.name = instrument.label.split(',')[0]
  track.shortName = track.name.slice(0, 10)
  track.playbackInfo.program = instrument.program
  track.playbackInfo.primaryChannel = 0
  track.playbackInfo.secondaryChannel = 1
  track.playbackInfo.volume = 15
  track.playbackInfo.balance = 8
  const staff = new model.Staff()
  const tuning = new model.Tuning()
  tuning.tunings = [...instrument.tuning]
  staff.stringTuning = tuning
  staff.showTablature = true
  staff.showStandardNotation = true
  track.addStaff(staff)
  return track
}

/** A song with one track of empty bars, saved as a Guitar Pro file. */
export function createSong(input: NewSongInput, settings = new alphaTab.Settings()): Uint8Array {
  const score = new model.Score()
  score.title = input.title
  score.artist = input.artist
  for (let index = 0; index < input.bars; index++) {
    const masterBar = new model.MasterBar()
    masterBar.timeSignatureNumerator = input.numerator
    masterBar.timeSignatureDenominator = input.denominator
    if (index === 0) {
      masterBar.tempoAutomations.push(model.Automation.buildTempoAutomation(false, 0, input.tempo, 2))
    }
    score.addMasterBar(masterBar)
  }
  const track = newTrack(input.instrument)
  const staff = track.staves[0]
  for (let index = 0; index < input.bars; index++) {
    const bar = new model.Bar()
    const voice = new model.Voice()
    const beat = new model.Beat()
    beat.isEmpty = true
    voice.addBeat(beat)
    bar.addVoice(voice)
    staff.addBar(bar)
  }
  score.addTrack(track)
  score.finish(settings)
  return new alphaTab.exporter.Gp7Exporter().export(score, settings)
}
