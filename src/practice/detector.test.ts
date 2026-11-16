import { describe, expect, it } from 'vitest'
import { type DetectedNote, NoteDetector } from './detector'
import { type SynthNote, synthesize } from './synth'

const RATE = 48000

function detect(notes: SynthNote[], totalSec: number, noiseFloor = 0.001, rate = RATE): DetectedNote[] {
  const audio = synthesize(notes, rate, totalSec, { noiseFloor })
  const found: DetectedNote[] = []
  const detector = new NoteDetector(rate, (note) => found.push(note))
  // Feed in uneven blocks, as a browser would.
  for (let i = 0; i < audio.length; i += 128) detector.feed(audio.subarray(i, i + 128))
  detector.flush()
  return found
}

/** Checks that exactly the given notes were found, each close in time and pitch. */
function expectNotes(found: DetectedNote[], notes: SynthNote[], timeToleranceSec = 0.02) {
  expect(found.map((n) => Math.round(n.midi[0]))).toEqual(notes.map((n) => n.midi))
  found.forEach((note, i) => {
    expect(Math.abs(note.midi[0] - notes[i].midi)).toBeLessThan(0.3)
    expect(Math.abs(note.timeSec - notes[i].timeSec)).toBeLessThan(timeToleranceSec)
  })
}

describe('NoteDetector', () => {
  it('finds the open strings of a guitar', () => {
    const notes = [40, 45, 50, 55, 59, 64].map((midi, i) => ({ timeSec: 0.3 + i * 0.5, midi, durationSec: 0.4 }))
    expectNotes(detect(notes, 3.6), notes)
  })

  it('finds high notes up the neck', () => {
    const notes = [72, 76, 79, 84].map((midi, i) => ({ timeSec: 0.3 + i * 0.4, midi, durationSec: 0.3 }))
    expectNotes(detect(notes, 2.2), notes)
  })

  it('separates fast repeated notes', () => {
    // Sixteenth notes at 120 bpm on one pitch.
    const notes = Array.from({ length: 12 }, (_, i) => ({ timeSec: 0.3 + i * 0.125, midi: 57, durationSec: 0.11 }))
    expectNotes(detect(notes, 2.2), notes)
  })

  it('follows an arpeggio whose notes keep ringing over each other', () => {
    const pitches = [45, 52, 57, 60, 64, 60, 57, 52]
    const notes = pitches.map((midi, i) => ({ timeSec: 0.3 + i * 0.3, midi }))
    expectNotes(detect(notes, 3.5), notes)
  })

  it('hears hammer-ons and pull-offs as new notes', () => {
    const notes: SynthNote[] = [
      { timeSec: 0.3, midi: 57 },
      { timeSec: 0.6, midi: 59, legato: true },
      { timeSec: 0.9, midi: 57, legato: true, durationSec: 0.3 },
      { timeSec: 1.2, midi: 60, durationSec: 0.4 },
    ]
    expectNotes(detect(notes, 2), notes, 0.045)
  })

  it('reads every note of the guitar range on its own', () => {
    for (let midi = 40; midi <= 88; midi++) {
      const found = detect([{ timeSec: 0.3, midi, durationSec: 0.5 }], 1)
      expect(found.map((n) => n.midi[0]), `midi ${midi}`).toEqual([midi])
    }
  })

  it('reads bass notes', () => {
    const notes = [28, 33, 38, 43].map((midi, i) => ({ timeSec: 0.3 + i * 0.5, midi, durationSec: 0.4 }))
    expectNotes(detect(notes, 2.6), notes)
  })

  it('never offers a neighbouring fret as an alternative', () => {
    const pitches = [45, 52, 57, 60, 64, 60, 57, 52, 40, 47, 55, 59]
    const notes = pitches.map((midi, i) => ({ timeSec: 0.3 + i * 0.25, midi }))
    for (const note of detect(notes, 4)) {
      const truth = notes.reduce((a, b) => (Math.abs(b.timeSec - note.timeSec) < Math.abs(a.timeSec - note.timeSec) ? b : a))
      for (const midi of note.midi) {
        const distance = Math.abs(midi - truth.midi)
        expect(distance === 0 || distance >= 3, `heard ${note.midi} for ${truth.midi}`).toBe(true)
      }
    }
  })

  it('stays quiet during silence and hiss', () => {
    expect(detect([], 2, 0.003)).toEqual([])
  })

  it('does not report a sustained note more than once', () => {
    const found = detect([{ timeSec: 0.3, midi: 52 }], 3)
    expect(found).toHaveLength(1)
  })

  it('works at 44.1 kHz', () => {
    const notes = [52, 55, 59].map((midi, i) => ({ timeSec: 0.3 + i * 0.4, midi, durationSec: 0.3 }))
    expectNotes(detect(notes, 1.8, 0.001, 44100), notes)
  })
})
