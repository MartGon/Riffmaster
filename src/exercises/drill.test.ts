import * as alphaTab from '@coderline/alphatab'
import { describe, expect, it } from 'vitest'
import { buildSheet, type Step, type Tone } from './build'
import { buildDrill, type DrillChoices, drillOptions, MAX_DRILL_BARS } from './drill'

type Score = alphaTab.model.Score

const load = (data: Uint8Array) => alphaTab.importer.ScoreLoader.loadScoreFromBytes(data)
const tone = (string: number, fret: number, legato = false): Tone => ({ string, fret, legato })
const note = (string: number, fret: number, length = 2): Step => ({ tones: [tone(string, fret)], length })
const song = (steps: Step[], tempo = 100) => load(buildSheet({ title: 'Song', tempo, steps }))
const only = (choice: Partial<DrillChoices>): DrillChoices => ({ slow: false, chunks: false, rhythms: false, strings: false, ...choice })
const all: DrillChoices = { slow: true, chunks: true, rhythms: true, strings: true }
const source = (first: number, last: number) => ({ songId: 'songsongsong', trackIndex: 0, first, last })
const drillOf = (score: Score, choices: DrillChoices, first = 0, last = 0) => {
  const built = buildDrill(score, source(first, last), choices)
  return { built, score: load(built.data) }
}
const sectionAt = (score: Score, name: string) => score.masterBars.findIndex((bar) => bar.section?.text.startsWith(name))
const barBeats = (score: Score, bar: number) => score.tracks[0].staves[0].bars[bar].voices[0].beats
const places = (score: Score, bar: number) =>
  barBeats(score, bar).flatMap((beat) => beat.notes.map((n) => `${n.string}:${n.fret}`))
const pitches = (score: Score, bar: number) => barBeats(score, bar).flatMap((beat) => beat.notes.map((n) => n.realValue))
/** Length of every voice in ticks must fill its bar, whatever was done to the rhythm. */
function expectFullBars(score: Score) {
  score.tracks[0].staves[0].bars.forEach((bar, index) => {
    const length = bar.voices[0].beats.reduce((sum, beat) => sum + beat.playbackDuration, 0)
    expect(length, `bar ${index + 1}`).toBe(score.masterBars[index].calculateDuration())
  })
}

const eighths = [3, 5, 7, 8, 5, 7, 8, 10].map((fret) => note(3, fret))

describe('what can be drilled', () => {
  it('refuses too many bars and bars without notes', () => {
    const long = song(Array.from({ length: (MAX_DRILL_BARS + 1) * 8 }, () => note(3, 5)))
    expect(drillOptions(long, 0, 0, MAX_DRILL_BARS).problem).toMatch(/or fewer/)
    const silent = song([...eighths, { tones: [], length: 16 }])
    expect(drillOptions(silent, 0, 1, 1).problem).toMatch(/no notes/)
  })

  it('refuses a drum track', () => {
    const score = song(eighths)
    score.tracks[0].staves[0].isPercussion = true
    expect(drillOptions(score, 0, 0, 0).problem).toMatch(/strings/)
  })

  it('offers rhythms only for even notes', () => {
    expect(drillOptions(song(eighths), 0, 0, 0).rhythms).toBe(true)
    expect(drillOptions(song([note(3, 5, 4), note(3, 7, 4), note(3, 8, 8)]), 0, 0, 0).rhythms).toBe(false)
  })

  it('offers other strings only when the line fits', () => {
    expect(drillOptions(song(eighths), 0, 0, 0).strings).toBe(true)
    // Open low string and open top string: nowhere to go either way with these frets.
    const stuck = song([note(1, 0, 8), note(6, 0, 8)])
    expect(drillOptions(stuck, 0, 0, 0).strings).toBe(false)
  })
})

describe('the drill', () => {
  it('is its own song with named parts, ending at full tempo', () => {
    const { built, score } = drillOf(song(eighths, 120), all)
    expect(built.sections).toEqual(['Slow', 'Chunks', 'Long-short', 'Short-long', 'One string up', 'One string down', 'Full tempo'])
    expect(score.title).toBe('Song: bar 1 drill')
    expect(score.artist).toBe('Exercise')
    expect(score.tracks).toHaveLength(1)
    expect(sectionAt(score, 'Slow')).toBe(0)
    expect(score.masterBars[sectionAt(score, 'Slow')].tempoAutomations[0].value).toBe(72)
    expect(score.masterBars[sectionAt(score, 'Full tempo')].tempoAutomations[0].value).toBe(120)
    expectFullBars(score)
  })

  it('keeps the tuning, and the notes of the passage in the slow part', () => {
    const original = song(eighths)
    original.tracks[0].staves[0].stringTuning.tunings = [62, 57, 53, 48, 43, 38]
    const { score } = drillOf(original, only({ slow: true }))
    expect(score.tracks[0].staves[0].stringTuning.tunings).toEqual([62, 57, 53, 48, 43, 38])
    expect(places(score, 0)).toEqual(places(original, 0))
    expect(pitches(score, 0)).toEqual(pitches(original, 0))
  })

  it('takes only the chosen bars', () => {
    const steps = [...eighths, ...eighths.map((step) => note(2, step.tones[0].fret)), ...eighths]
    const { score } = drillOf(song(steps), only({ slow: true }), 1, 1)
    expect(places(score, 0).every((place) => place.startsWith('2:'))).toBe(true)
  })

  it('splits a short passage at the half bar, then joins the halves', () => {
    const { score } = drillOf(song(eighths), only({ chunks: true }))
    const start = sectionAt(score, 'Chunks')
    const front = places(song(eighths), 0).slice(0, 4)
    const back = places(song(eighths), 0).slice(4)
    expect(places(score, start)).toEqual(front)
    expect(places(score, start + 1)).toEqual(front)
    expect(places(score, start + 2)).toEqual(back)
    expect(places(score, start + 3)).toEqual(back)
    expect(places(score, start + 4)).toEqual([...front, ...back])
    expectFullBars(score)
  })

  it('chunks a longer passage by the bar, joining each to the next', () => {
    const steps = [0, 1, 2].flatMap((bar) => eighths.map((step) => note(bar + 1, step.tones[0].fret)))
    const { score } = drillOf(song(steps), only({ chunks: true }), 0, 2)
    const start = sectionAt(score, 'Chunks')
    const strings = Array.from({ length: 7 }, (_, offset) => places(score, start + offset)[0][0])
    expect(strings).toEqual(['1', '2', '1', '2', '3', '2', '3'])
  })

  it('plays even notes long-short and short-long, and every bar still adds up', () => {
    const { score } = drillOf(song(eighths), only({ rhythms: true }))
    const longShort = barBeats(score, sectionAt(score, 'Long-short'))
    expect([longShort[0].dots, longShort[0].duration, longShort[1].dots, longShort[1].duration]).toEqual([1, 8, 0, 16])
    const shortLong = barBeats(score, sectionAt(score, 'Short-long'))
    expect([shortLong[0].dots, shortLong[0].duration, shortLong[1].dots, shortLong[1].duration]).toEqual([0, 16, 1, 8])
    expectFullBars(score)
  })

  it('does the same with sixteenths', () => {
    const sixteenths = Array.from({ length: 16 }, (_, index) => note(3, 5 + (index % 3), 1))
    const { score } = drillOf(song(sixteenths), only({ rhythms: true }))
    const beats = barBeats(score, sectionAt(score, 'Long-short'))
    expect([beats[0].dots, beats[0].duration, beats[1].duration]).toEqual([1, 16, 32])
    expectFullBars(score)
  })

  it('leaves dotted notes and notes off the grid alone', () => {
    const uneven: Step[] = [note(3, 5, 4), note(3, 7, 2), note(3, 8, 2), note(3, 5, 2), note(3, 7, 2), note(3, 8, 4)]
    const { score } = drillOf(song(uneven), only({ rhythms: true }))
    expect(barBeats(score, sectionAt(score, 'Long-short'))[0].dots).toBe(0)
    expectFullBars(score)
  })

  it('moves the line to the next string with the same intervals, across the G and B strings too', () => {
    const line = [note(3, 5), note(3, 7), note(4, 5), note(4, 7), note(5, 5), note(5, 8), note(4, 7), note(3, 5)]
    const original = song(line)
    const { score } = drillOf(original, only({ strings: true }))
    const up = sectionAt(score, 'One string up')
    const heard = pitches(score, up)
    const written = pitches(original, 0)
    expect(heard).toEqual(written.map((pitch) => pitch + 5))
    expect(places(score, up)[0]).toBe('4:5')
    // The third string's fret 5 on the G string becomes fret 6 on the B string.
    expect(places(score, up)[2]).toBe('5:6')
  })

  it('leaves out a direction the line does not fit', () => {
    const { built } = drillOf(song([note(1, 5, 8), note(1, 7, 8)]), only({ strings: true }))
    expect(built.sections).toEqual(['One string up', 'Full tempo'])
  })

  it('drops a tie whose first note is not in the drill', () => {
    const score = song(eighths)
    const tied = barBeats(score, 0)[4].notes[0]
    tied.fret = barBeats(score, 0)[3].notes[0].fret
    tied.string = barBeats(score, 0)[3].notes[0].string
    tied.isTieDestination = true
    score.finish(new alphaTab.Settings())
    const { score: drill } = drillOf(score, only({ chunks: true }))
    const back = barBeats(drill, sectionAt(drill, 'Chunks') + 2)
    const first = back.find((beat) => beat.notes.length > 0)!
    expect(first.notes[0].isTieDestination).toBe(false)
    expect(first.notes[0].fret).toBe(8)
    // Joined again, the tie is back.
    const joined = barBeats(drill, sectionAt(drill, 'Chunks') + 4)
    expect(joined[4].notes[0].isTieDestination).toBe(true)
  })

  it('drops legato into a note that is not in the chunk', () => {
    const steps: Step[] = [note(3, 5), note(3, 7), note(3, 5), { tones: [tone(3, 7, true)], length: 2 }, note(3, 9), note(3, 7), note(3, 5), note(3, 7)]
    const { score } = drillOf(song(steps), only({ chunks: true }))
    const front = barBeats(score, sectionAt(score, 'Chunks'))
    expect(front[3].notes[0].isHammerPullOrigin).toBe(false)
    const joined = barBeats(score, sectionAt(score, 'Chunks') + 4)
    expect(joined[3].notes[0].isHammerPullOrigin).toBe(true)
  })

  it('keeps triplets and other time signatures intact', () => {
    const score = song(eighths)
    score.masterBars[0].timeSignatureNumerator = 3
    const beats = barBeats(score, 0)
    // Six triplet eighths take two beats, and two plain eighths the third.
    for (const beat of beats.slice(0, 6)) {
      beat.tupletNumerator = 3
      beat.tupletDenominator = 2
    }
    score.finish(new alphaTab.Settings())
    const { score: drill } = drillOf(score, only({ slow: true, chunks: true, rhythms: true }))
    expect(drill.masterBars.every((bar) => bar.timeSignatureNumerator === 3)).toBe(true)
    expectFullBars(drill)
    const slow = barBeats(drill, 0)
    expect(slow.slice(0, 6).every((beat) => beat.tupletNumerator === 3)).toBe(true)
    const longShort = barBeats(drill, sectionAt(drill, 'Long-short'))
    expect(longShort.slice(0, 6).every((beat) => beat.dots === 0 && beat.tupletNumerator === 3)).toBe(true)
    expect([longShort[6].dots, longShort[7].duration]).toEqual([1, 16])
  })

  it('plays straight through past D.C. and Fine marks', () => {
    const score = song([...eighths, ...eighths])
    score.masterBars[0].addDirection(alphaTab.model.Direction.TargetFine)
    score.masterBars[1].addDirection(alphaTab.model.Direction.JumpDaCapoAlFine)
    score.finish(new alphaTab.Settings())
    const { score: drill } = drillOf(score, only({ slow: true }), 0, 1)
    expect(drill.masterBars.every((bar) => !bar.directions || bar.directions.size === 0)).toBe(true)
  })

  it('uses the tempo at the start of the bar, not a change later in it', () => {
    const score = song(eighths, 100)
    score.masterBars[0].tempoAutomations.push(alphaTab.model.Automation.buildTempoAutomation(false, 0.5, 200, 2))
    const { score: drill } = drillOf(score, only({ slow: true }))
    expect(drill.masterBars[0].tempoAutomations[0].value).toBe(60)
    expect(drill.masterBars[sectionAt(drill, 'Full tempo')].tempoAutomations[0].value).toBe(100)
  })

  it('drops a slide whose target is not in the chunk', () => {
    const score = song(eighths.map((step) => note(3, step.tones[0].fret)))
    barBeats(score, 0)[3].notes[0].slideOutType = alphaTab.model.SlideOutType.Shift
    score.finish(new alphaTab.Settings())
    const { score: drill } = drillOf(score, only({ chunks: true }))
    const start = sectionAt(drill, 'Chunks')
    expect(barBeats(drill, start)[3].notes[0].slideOutType).toBe(alphaTab.model.SlideOutType.None)
    expect(barBeats(drill, start + 4)[3].notes[0].slideOutType).toBe(alphaTab.model.SlideOutType.Shift)
  })

  it('makes a new drill when only an articulation changed', () => {
    const score = song(eighths)
    const before = buildDrill(score, source(0, 0), all).fileName
    barBeats(score, 0)[2].notes[0].isPalmMute = true
    expect(buildDrill(score, source(0, 0), all).fileName).not.toBe(before)
  })

  it('takes the chord name off a shape moved to other strings', () => {
    const chord: Step = { tones: [tone(2, 3), tone(3, 2)], length: 16, chord: 'C' }
    const score = load(buildSheet({
      title: 'Song',
      tempo: 100,
      steps: [chord],
      chords: { C: { frets: [-1, 3, 2, 0, 1, 0] } },
    }))
    const { score: drill } = drillOf(score, only({ strings: true }))
    expect(barBeats(drill, sectionAt(drill, 'One string down'))[0].chordId).toBeNull()
    expect(barBeats(drill, sectionAt(drill, 'Full tempo'))[0].chordId).toBe('C')
  })

  it('keeps the note on each main beat of 6/8 in place', () => {
    const score = song(eighths.slice(0, 6))
    score.masterBars[0].timeSignatureNumerator = 6
    score.masterBars[0].timeSignatureDenominator = 8
    const voice = score.tracks[0].staves[0].bars[0].voices[0]
    voice.beats.splice(6)
    score.finish(new alphaTab.Settings())
    const { score: drill } = drillOf(score, only({ rhythms: true }))
    const beats = barBeats(drill, sectionAt(drill, 'Long-short'))
    const onSecondBeat = beats.reduce((tick, beat, index) => (index < 3 ? tick + beat.playbackDuration : tick), 0)
    expect(onSecondBeat).toBe(1440)
    expectFullBars(drill)
  })

  it('sounds on the instrument the passage is played with', () => {
    const score = song([...eighths, ...eighths])
    barBeats(score, 0)[0].automations.push(alphaTab.model.Automation.buildInstrumentAutomation(false, 0, 30))
    const { score: drill } = drillOf(score, only({ slow: true }), 1, 1)
    expect(drill.tracks[0].playbackInfo.program).toBe(30)
  })

  it('keeps the peak of a bend with many points', () => {
    const score = song(eighths)
    const bent = barBeats(score, 0)[0].notes[0]
    for (const [offset, value] of [[0, 0], [15, 2], [30, 4], [45, 2], [60, 0]]) {
      bent.addBendPoint(new alphaTab.model.BendPoint(offset, value))
    }
    bent.bendType = alphaTab.model.BendType.Custom
    score.finish(new alphaTab.Settings())
    const { score: drill } = drillOf(score, only({ slow: true }))
    const points = barBeats(drill, 0)[0].notes[0].bendPoints ?? []
    expect(Math.max(...points.map((point) => point.value))).toBe(4)
  })

  it('says so when a pick-up bar cannot be drilled, and when one is left out', () => {
    const score = song([...eighths, ...eighths])
    score.masterBars[0].isAnacrusis = true
    expect(drillOptions(score, 0, 0, 0).problem).toMatch(/pick-up/)
    const options = drillOptions(score, 0, 0, 1)
    expect([options.problem, options.leftOutPickup]).toEqual([null, true])
  })

  it('keeps a hammer-on into a grace note', () => {
    const score = song(eighths.map((step) => note(3, step.tones[0].fret)))
    const beats = barBeats(score, 0)
    beats[1].notes[0].isHammerPullOrigin = true
    beats[2].graceType = alphaTab.model.GraceType.BeforeBeat
    score.finish(new alphaTab.Settings())
    const { score: drill } = drillOf(score, only({ slow: true }))
    expect(barBeats(drill, 0)[1].notes[0].isHammerPullOrigin).toBe(true)
  })

  it('moves a trill with the line', () => {
    const score = song(eighths)
    const trilled = barBeats(score, 0)[0].notes[0]
    trilled.trillValue = trilled.realValue + 2
    trilled.trillSpeed = alphaTab.model.Duration.Sixteenth
    const written = trilled.trillValue
    score.finish(new alphaTab.Settings())
    const { score: drill } = drillOf(score, only({ strings: true }))
    expect(barBeats(drill, sectionAt(drill, 'One string up'))[0].notes[0].trillValue).toBe(written + 5)
  })

  it('keeps the main beats of 6/16 in place', () => {
    const sixteenths = Array.from({ length: 6 }, (_, index) => note(3, 5 + index, 1))
    const score = song(sixteenths)
    score.masterBars[0].timeSignatureNumerator = 6
    score.masterBars[0].timeSignatureDenominator = 16
    const voice = score.tracks[0].staves[0].bars[0].voices[0]
    voice.beats.splice(6)
    score.finish(new alphaTab.Settings())
    const { score: drill } = drillOf(score, only({ rhythms: true }))
    const beats = barBeats(drill, sectionAt(drill, 'Long-short'))
    expect(beats.slice(0, 3).reduce((sum, beat) => sum + beat.playbackDuration, 0)).toBe(720)
    expectFullBars(drill)
  })

  it('draws no whammy over a silenced beat', () => {
    const score = song(eighths)
    const beat = barBeats(score, 0)[6]
    beat.addWhammyBarPoint(new alphaTab.model.BendPoint(0, 0))
    beat.addWhammyBarPoint(new alphaTab.model.BendPoint(60, -4))
    score.finish(new alphaTab.Settings())
    const { score: drill } = drillOf(score, only({ chunks: true }))
    expect(barBeats(drill, sectionAt(drill, 'Chunks'))[6].hasWhammyBar).toBe(false)
  })

  it('gets the same file name for the same passage and another for another', () => {
    const score = song([...eighths, ...eighths.map((step) => note(2, step.tones[0].fret))])
    const once = buildDrill(score, source(0, 0), all).fileName
    expect(buildDrill(score, source(0, 0), all).fileName).toBe(once)
    expect(buildDrill(score, source(1, 1), all).fileName).not.toBe(once)
    expect(buildDrill(score, source(0, 0), only({ slow: true })).fileName).not.toBe(once)
  })
})
