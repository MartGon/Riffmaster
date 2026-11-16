import * as alphaTab from '@coderline/alphatab'
import { describe, expect, it } from 'vitest'
import { trackEvents, trackFingerings } from './fromScore'

/** A one-track score from alphaTex, where notes are written `fret.string` with string 1 the highest. */
function track(tex: string): alphaTab.model.Track {
  const settings = new alphaTab.Settings()
  const importer = new alphaTab.importer.AlphaTexImporter()
  importer.initFromString(tex, settings)
  return importer.readScore().tracks[0]
}
const allNotes = (t: alphaTab.model.Track) =>
  t.staves[0].bars.flatMap((bar) => bar.voices.flatMap((voice) => voice.beats.flatMap((beat) => beat.notes)))
/** Fingers in the order the notes are written, '-' where there is none. */
const fingers = (t: alphaTab.model.Track) => {
  const found = trackFingerings(t)
  return allNotes(t).map((note) => found.get(note.id)?.finger ?? '-')
}

describe('reading a track', () => {
  it('counts strings from the lowest and leaves open strings without a finger', () => {
    // Low E string: open, 1, 3; then A string: open, 2, 3.
    const t = track(':8 0.6 1.6 3.6 0.5 2.5 3.5 r r')
    const events = trackEvents(t)!.events
    expect(events.map((event) => [event.notes[0].string, event.notes[0].fret])).toEqual([[1, 0], [1, 1], [1, 3], [2, 0], [2, 2], [2, 3]])
    expect(fingers(t)).toEqual(['-', 1, 3, '-', 2, 3])
  })

  it('keeps a ringing note down until its string is struck again or the ringing stops', () => {
    const t = track(':8 3.5{lr} 2.4{lr} 0.3{lr} 2.4{lr} 3.5 r r r')
    const events = trackEvents(t)!.events
    // The C on the A string rings through the three notes after it.
    expect(events[0].notes[0]).toMatchObject({ until: events[4].tick, firm: false })
    // The first E on the D string gives way when the string is struck again.
    expect(events[1].notes[0].until).toBe(events[3].tick)
    // The last note is not marked, so it lasts as long as it is written.
    expect(events[4].notes[0]).toMatchObject({ until: events[4].tick + 480, firm: true })
  })

  it('treats a tied note as its first note held on', () => {
    const t = track(':4 3.5 -.5 2.4 r')
    const prepared = trackEvents(t)!
    expect(prepared.events).toHaveLength(2)
    expect(prepared.events[0].notes[0].until).toBe(1920)
    const found = trackFingerings(t)
    const [first, tied] = allNotes(t)
    expect(found.get(tied.id)).toBe(found.get(first.id))
  })

  it('passes slides, hammer-ons and bends on', () => {
    const t = track(':8 5.3{sl} 7.3 5.3{h} 7.3 7.3{b (0 4)} r r r')
    const notes = trackEvents(t)!.events.map((event) => event.notes[0])
    expect(notes[1].slideFrom).toBe(notes[0].id)
    expect(notes[3].legatoFrom).toBe(notes[2].id)
    expect(notes[4].bend).toBe(true)
    const result = fingers(t)
    expect(result[1]).toBe(result[0])
    expect(result[3]).not.toBe(result[2])
  })

  it('keeps the finger for a slide that starts on a tied note', () => {
    const t = track(':8 5.3 7.3 -.3{sl} 9.3 r r r r')
    const result = fingers(t)
    // 5, 7, the tie (same finger as 7), then 9 with that finger again.
    expect(result[2]).toBe(result[1])
    expect(result[3]).toBe(result[1])
  })

  it('leaves a note the file gives to the thumb out of the search', () => {
    // alphaTex counts the thumb as 1.
    const t = track(':8 1.6{lf 1} 3.5 2.4 r')
    const found = trackFingerings(t)
    const notes = allNotes(t)
    expect(found.get(notes[0].id)).toMatchObject({ finger: 'T', source: 'file' })
    expect(trackEvents(t)!.events).toHaveLength(2)
    expect(fingers(t)).toEqual(['T', 2, 1])
  })

  it('keeps fingers written in the file and says where they came from', () => {
    // alphaTex counts the thumb as 1, so 3 is the middle finger.
    const t = track(':8 5.3{lf 3} 7.3 8.3 r')
    const found = trackFingerings(t)
    const notes = allNotes(t)
    expect(found.get(notes[0].id)).toMatchObject({ finger: 2, source: 'file' })
    expect(found.get(notes[1].id)).toMatchObject({ source: 'suggested' })
    // The rest is built around it: with the middle finger on 5, the higher frets go to the fingers after it.
    expect(fingers(t)).toEqual([2, 3, 4])
  })

  it('leaves dead notes alone', () => {
    const t = track(':8 x.3 5.3 x.3 7.3')
    expect(fingers(t)).toEqual(['-', 1, '-', 3])
  })

  it('counts the hand position from the nut when there is a capo', () => {
    const t = track('\\capo 3 . :8 1.6 2.6 3.6 4.6')
    const found = trackFingerings(t)
    expect(fingers(t)).toEqual([1, 2, 3, 4])
    expect(found.get(allNotes(t)[0].id)?.position).toBe(4)
  })

  it('has nothing to say about drums', () => {
    const t = track('\\instrument percussion . :4 36 38 36 38')
    expect(trackEvents(t)).toBeNull()
    expect(trackFingerings(t).size).toBe(0)
  })
})
