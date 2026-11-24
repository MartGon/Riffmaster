import * as alphaTab from '@coderline/alphatab'
import { describe, expect, it } from 'vitest'
import { applySetup, cleanSetup, undoSetup } from './guitarSetup'

/** A one-track score from alphaTex, where notes are written `fret.string` with string 1 the highest. */
function track(tex: string): alphaTab.model.Track {
  const settings = new alphaTab.Settings()
  const importer = new alphaTab.importer.AlphaTexImporter()
  importer.initFromString(tex, settings)
  return importer.readScore().tracks[0]
}
const notes = (t: alphaTab.model.Track) =>
  t.staves[0].bars.flatMap((bar) => bar.voices.flatMap((voice) => voice.beats.flatMap((beat) => beat.notes)))
/** Each note as `fret.string`, string 1 being the highest, as alphaTex writes them. */
const tab = (t: alphaTab.model.Track) => notes(t).map((note) => `${note.fret}.${t.staves[0].tuning.length + 1 - note.string}`)
const pitches = (t: alphaTab.model.Track) => notes(t).map((note) => note.realValue)

describe('guitar setup', () => {
  it('shows frets from the capo, sounding the same', () => {
    const t = track(':4 5.6 7.5 3.2 12.1')
    const before = pitches(t)
    applySetup(t, { capo: 2 })
    expect(tab(t)).toEqual(['3.6', '5.5', '1.2', '10.1'])
    expect(pitches(t)).toEqual(before)
    expect(t.staves[0].capo).toBe(2)
  })

  it('takes the written capo off', () => {
    const t = track('\\capo 3 . :4 0.6 2.5')
    const before = pitches(t)
    applySetup(t, { capo: 0 })
    expect(tab(t)).toEqual(['3.6', '5.5'])
    expect(pitches(t)).toEqual(before)
  })

  it('re-frets a string tuned on its own, as in drop D', () => {
    const t = track(':4 0.6 3.6 2.5 0.1')
    const before = pitches(t)
    applySetup(t, { strings: [0, 0, 0, 0, 0, -2] })
    expect(tab(t)).toEqual(['2.6', '5.6', '2.5', '0.1'])
    expect(pitches(t)).toEqual(before)
    expect(t.staves[0].tuning.at(-1)).toBe(38)
  })

  it('moves a note below the capo to another string', () => {
    const t = track(':4 0.1 (0.1 3.2)')
    const before = pitches(t)
    const [applied] = applySetup(t, { capo: 2 })
    // The open high E, at capo 2, is fret 3 of the B string. In the chord the
    // B string is taken, so the E goes to the G string.
    expect(tab(t)).toEqual(['3.2', '7.3', '1.2'])
    expect(pitches(t)).toEqual(before)
    expect(applied.moved).toBe(2)
    expect(applied.unplayable).toBe(0)
  })

  it('keeps a tied note with the note it continues', () => {
    const t = track(':4 0.1 -.1')
    applySetup(t, { capo: 2 })
    expect(tab(t)).toEqual(['3.2', '3.2'])
  })

  it('counts a note no string can play, and keeps its pitch', () => {
    const t = track(':4 0.6')
    const before = pitches(t)
    const [applied] = applySetup(t, { capo: 5 })
    expect(applied.unplayable).toBe(1)
    expect(pitches(t)).toEqual(before)
  })

  it('puts everything back as written', () => {
    const t = track('\\capo 1 . :4 0.6 (0.1 3.2) 5.3')
    const before = tab(t)
    const applied = applySetup(t, { capo: 4, strings: [1, 0, 0, 0, 0, -2] })
    undoSetup(applied)
    expect(tab(t)).toEqual(before)
    expect(t.staves[0].capo).toBe(1)
    expect([...t.staves[0].tuning]).toEqual([64, 59, 55, 50, 45, 40])
  })

  it('moves a natural harmonic to a node of another string that sounds the same', () => {
    // The 7th-fret harmonic of the A string is E4; with a capo on 2 it is the D string's 12th-fret node.
    const t = track(':4 7.5{nh}')
    const before = pitches(t)
    const [applied] = applySetup(t, { capo: 2 })
    expect(pitches(t)).toEqual(before)
    expect(tab(t)).toEqual(['12.4'])
    expect(notes(t)[0].harmonicType).toBe(1)
    expect(applied.moved).toBe(1)
    undoSetup([applied])
    expect(tab(t)).toEqual(['7.5'])
    expect(notes(t)[0].harmonicValue).toBe(7)
  })

  it('counts a natural harmonic that no string has, as unplayable', () => {
    // E3, the low string's octave: no open string at capo 2 has it as a harmonic.
    const t = track(':4 12.6{nh}')
    const [applied] = applySetup(t, { capo: 2 })
    expect(applied.unplayable).toBe(1)
  })

  it('does not put a tied note on a string another note of the beat has', () => {
    const t = track(':4 0.5 (-.5 2.6)')
    const before = pitches(t)
    applySetup(t, { capo: 2 })
    const beats = t.staves[0].bars[0].voices[0].beats
    const strings = beats[1].notes.map((note) => note.string)
    expect(new Set(strings).size).toBe(strings.length)
    expect(pitches(t)).toEqual(before)
  })

  it('leaves muted notes on their strings, uncounted', () => {
    const t = track(':4 (0.1{x} 0.2{x} 0.3{x} 0.4{x} 0.5{x} 0.6{x})')
    const [applied] = applySetup(t, { capo: 3 })
    expect(tab(t)).toEqual(['0.1', '0.2', '0.3', '0.4', '0.5', '0.6'])
    expect(applied.moved + applied.unplayable).toBe(0)
  })

  it('keeps a hammer-on or slide on one string', () => {
    for (const tex of [':8 0.1{h} 2.1', ':8 1.1{ss} 4.1']) {
      const t = track(tex)
      const before = pitches(t)
      applySetup(t, { capo: 2 })
      const [a, b] = notes(t)
      expect(a.string).toBe(b.string)
      expect(pitches(t)).toEqual(before)
    }
  })

  it('tells alphaTab which notes are on which string again', () => {
    const t = track(':4 (0.1 0.2)')
    applySetup(t, { capo: 2 })
    const beat = t.staves[0].bars[0].voices[0].beats[0]
    expect([...beat.noteStringLookup.keys()].sort()).toEqual(beat.notes.map((note) => note.string).sort())
    expect(beat.minStringNote?.string).toBe(Math.min(...beat.notes.map((note) => note.string)))
  })

  it('names the tuning it makes, and puts the name back', () => {
    const t = track(':4 0.6')
    const name = t.staves[0].stringTuning.name
    const applied = applySetup(t, { strings: [0, 0, 0, 0, 0, -2] })
    expect(t.staves[0].stringTuning.name).not.toBe(name)
    undoSetup(applied)
    expect(t.staves[0].stringTuning.name).toBe(name)
  })

  it('checks a stored setup against the track', () => {
    expect(cleanSetup({ capo: 3 }, 6)).toEqual({ capo: 3 })
    expect(cleanSetup({ capo: 13, strings: [0, 0, 0, 0, 0, -2] }, 6)).toEqual({ strings: [0, 0, 0, 0, 0, -2] })
    expect(cleanSetup({ strings: [0, 0, 0, -2] }, 6)).toBeNull()
    expect(cleanSetup({ strings: [0, 0, 0, 0, 0, 0] }, 6)).toBeNull()
    expect(cleanSetup({ capo: 1.5, strings: [9, 0, 0, 0, 0, 0] }, 6)).toBeNull()
    expect(cleanSetup('x', 6)).toBeNull()
    expect(cleanSetup({ capo: 2 }, 0)).toBeNull()
  })
})
