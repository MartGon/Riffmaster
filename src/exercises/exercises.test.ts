import * as alphaTab from '@coderline/alphatab'
import { describe, expect, it } from 'vitest'
import { trackFingerings } from '../fingering/fromScore'
import { intoBars, type Step } from './build'
import { buildExercise, EXERCISES, type Exercise, initialValues } from './catalogue'
import { ARPEGGIOS, arpeggioPlaces, CHORDS, type Place, pitchOf, PROGRESSIONS, SCALES, scalePlaces } from './theory'

const scale = (id: string) => SCALES.find((item) => item.id === id)!
const exercise = (id: string) => EXERCISES.find((item) => item.id === id)!
/** Frets per string from the lowest, e.g. "5 8 | 5 7". */
const drawn = (places: Place[]) =>
  [1, 2, 3, 4, 5, 6].map((string) => places.filter((p) => p.string === string).map((p) => p.fret).join(' ')).join(' | ')
const load = (data: Uint8Array) => alphaTab.importer.ScoreLoader.loadScoreFromBytes(data)
const beatsOf = (score: alphaTab.model.Score) =>
  score.tracks[0].staves[0].bars.flatMap((bar) => bar.voices[0].beats)

/** Every combination of an exercise's choices. */
function combinations(item: Exercise): Record<string, string>[] {
  let all: Record<string, string>[] = [{}]
  for (const option of item.options) {
    all = all.flatMap((values) => option.choices.map((choice) => ({ ...values, [option.id]: choice.value })))
  }
  return all
}

describe('scale positions', () => {
  it('lays the A minor pentatonic out as the five usual boxes', () => {
    const boxes = [0, 1, 2, 3, 4].map((position) => drawn(scalePlaces(scale('minor-pentatonic'), 9, position)))
    expect(boxes).toEqual([
      '5 8 | 5 7 | 5 7 | 5 7 | 5 8 | 5 8',
      '8 10 | 7 10 | 7 10 | 7 9 | 8 10 | 8 10',
      '10 12 | 10 12 | 10 12 | 9 12 | 10 13 | 10 12',
      '0 3 | 0 3 | 0 2 | 0 2 | 1 3 | 0 3',
      '3 5 | 3 5 | 2 5 | 2 5 | 3 5 | 3 5',
    ])
  })

  it('starts the major pentatonic on its own root', () => {
    expect(drawn(scalePlaces(scale('major-pentatonic'), 0, 0))).toBe('8 10 | 7 10 | 7 10 | 7 9 | 8 10 | 8 10')
  })

  it('adds the flattened fifth to the blues scale', () => {
    expect(drawn(scalePlaces(scale('blues'), 9, 0))).toBe('5 8 | 5 6 7 | 5 7 | 5 7 8 | 5 8 | 5 8')
  })

  it('lays the C major scale out in its five positions', () => {
    const positions = [0, 1, 2, 3, 4].map((position) => drawn(scalePlaces(scale('major'), 0, position)))
    expect(positions).toEqual([
      '7 8 10 | 7 8 10 | 7 9 10 | 7 9 10 | 8 10 | 7 8 10',
      '10 12 13 | 10 12 | 9 10 12 | 9 10 12 | 10 12 13 | 10 12 13',
      '0 1 3 | 0 2 3 | 0 2 3 | 0 2 | 0 1 3 | 0 1 3',
      '3 5 | 2 3 5 | 2 3 5 | 2 4 5 | 3 5 6 | 3 5',
      '5 7 8 | 5 7 8 | 5 7 | 4 5 7 | 5 6 8 | 5 7 8',
    ])
  })

  it('uses the same positions for a minor scale as for its relative major', () => {
    for (let position = 0; position < 5; position++) {
      // A minor position 1 is C major position 5, and so on round.
      expect(drawn(scalePlaces(scale('minor'), 9, position))).toBe(drawn(scalePlaces(scale('major'), 0, (position + 4) % 5)))
    }
  })

  it('gives every scale, key and position the right notes, in order, under one hand', () => {
    for (const item of SCALES) {
      for (let root = 0; root < 12; root++) {
        const tones = [...item.intervals, ...(item.extra === undefined ? [] : [item.extra])].map((i) => (root + i) % 12)
        for (let position = 0; position < item.shapes.length; position++) {
          const places = scalePlaces(item, root, position)
          const pitches = places.map(pitchOf)
          const where = `${item.id} ${root} ${position}: ${drawn(places)}`
          // Rising, with no note of the scale left out on the way.
          const expected: number[] = []
          for (let pitch = pitches[0]; pitch <= pitches[pitches.length - 1]; pitch++) {
            if (tones.includes(pitch % 12)) expected.push(pitch)
          }
          expect(pitches, where).toEqual(expected)
          // Strings never go back, and each string's notes rise.
          for (let i = 1; i < places.length; i++) expect(places[i].string, where).toBeGreaterThanOrEqual(places[i - 1].string)
          const frets = places.map((place) => place.fret)
          expect(Math.min(...frets), where).toBeGreaterThanOrEqual(0)
          expect(Math.max(...frets), where).toBeLessThanOrEqual(17)
          expect(Math.max(...frets) - Math.min(...frets), where).toBeLessThanOrEqual(4)
        }
      }
    }
  })
})

describe('arpeggios and chords', () => {
  it('lays arpeggios out as the usual shapes', () => {
    const shapes = Object.fromEntries(ARPEGGIOS.map((item) => [item.id, drawn(arpeggioPlaces(item, item.rootString === 1 ? 7 : 0))]))
    expect(shapes).toEqual({
      'major-6': '3 | 2 5 | 5 | 4 | 3 | 3',
      'minor-6': '3 6 | 5 | 5 | 3 | 3 | 3',
      'major-5': ' | 3 | 2 5 | 5 | 5 | 3',
      'minor-5': ' | 3 6 | 5 | 5 | 4 | 3',
    })
  })

  it('uses only chord notes, rising from the root', () => {
    for (const item of ARPEGGIOS) {
      for (let root = 0; root < 12; root++) {
        const places = arpeggioPlaces(item, root)
        const pitches = places.map(pitchOf)
        const tones = [0, item.minor ? 3 : 4, 7].map((i) => (root + i) % 12)
        expect(pitches[0] % 12).toBe(root)
        expect(pitches.every((pitch) => tones.includes(pitch % 12))).toBe(true)
        expect([...pitches].sort((a, b) => a - b)).toEqual(pitches)
        expect(new Set(pitches).size).toBe(pitches.length)
        expect(Math.min(...places.map((place) => place.fret))).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('spells each chord correctly', () => {
    const notes: Record<string, number[]> = {
      E: [4, 8, 11], A: [9, 1, 4], D: [2, 6, 9], G: [7, 11, 2], C: [0, 4, 7], F: [5, 9, 0],
      Em: [4, 7, 11], Am: [9, 0, 4], Dm: [2, 5, 9], Bm: [11, 2, 6], B7: [11, 3, 6, 9],
    }
    for (const [name, chord] of Object.entries(CHORDS)) {
      const sounding = chord.frets.flatMap((fret, index) => (fret < 0 ? [] : [pitchOf({ string: index + 1, fret }) % 12]))
      expect(new Set(sounding), name).toEqual(new Set(notes[name]))
      // The lowest note played is the root.
      expect(sounding[0], name).toBe(notes[name][0])
    }
    for (const chords of PROGRESSIONS) for (const name of chords) expect(CHORDS[name], name).toBeDefined()
  })
})

describe('writing out', () => {
  const eighth = (fret: number): Step => ({ tones: [{ string: 1, fret }], length: 2 })

  it('holds the last note and fills the bar with rests', () => {
    const bars = intoBars(Array.from({ length: 11 }, (_, i) => eighth(i)))
    expect(bars.map((bar) => bar.map((step) => `${step.tones.length ? 'n' : 'r'}${step.length}`).join(' '))).toEqual([
      'n2 n2 n2 n2 n2 n2 n2 n2',
      'n2 n2 n4 r8',
    ])
    expect(intoBars(Array.from({ length: 8 }, (_, i) => eighth(i)))).toHaveLength(1)
  })

  it('refuses a note that crosses a bar line', () => {
    expect(() => intoBars([eighth(1), { tones: [{ string: 1, fret: 1 }], length: 16 }])).toThrow()
  })

  it('writes every exercise with every choice into full bars', () => {
    let count = 0
    let highest = 0
    for (const item of EXERCISES) {
      for (const values of combinations(item)) {
        const sheet = item.make(values)
        const bars = intoBars(sheet.steps)
        for (const bar of bars) expect(bar.reduce((sum, step) => sum + step.length, 0), sheet.title).toBe(16)
        expect(bars.length, sheet.title).toBeGreaterThanOrEqual(2)
        expect(bars.length, sheet.title).toBeLessThanOrEqual(24)
        for (const step of sheet.steps) {
          for (const tone of step.tones) {
            expect(tone.fret, sheet.title).toBeGreaterThanOrEqual(0)
            highest = Math.max(highest, tone.fret)
          }
        }
        count++
      }
    }
    expect(count).toBeGreaterThan(1000)
    expect(highest).toBe(15)
  })

  it('gives each exercise and choice its own title and file name', () => {
    const titles = new Set<string>()
    const files = new Set<string>()
    let count = 0
    for (const item of EXERCISES) {
      // The first and last of each exercise's combinations are written to a file; the rest only titled.
      const all = combinations(item)
      for (const values of all) titles.add(item.make(values).title)
      for (const values of [all[0], all[all.length - 1]]) files.add(buildExercise(item, values).fileName)
      count += all.length
    }
    expect(titles.size).toBe(count)
    expect(files.size).toBe(EXERCISES.length * 2)
  })

  it('opens again as a tab with the same notes', () => {
    for (const item of EXERCISES) {
      const values = initialValues(item)
      const sheet = item.make(values)
      const built = buildExercise(item, values)
      const score = load(built.data)
      expect(score.title).toBe(sheet.title)
      expect(built.title).toBe(sheet.title)
      expect(score.tempo).toBe(sheet.tempo)
      const beats = beatsOf(score).filter((beat) => beat.notes.length > 0)
      expect(beats.map((beat) => beat.notes.map((note) => `${note.string}:${note.fret}`).sort().join(' ')), item.id).toEqual(
        sheet.steps.map((step) => step.tones.map((tone) => `${tone.string}:${tone.fret}`).sort().join(' ')),
      )
    }
  })

  it('falls back to the usual choices when given unknown ones', () => {
    const item = exercise('spider')
    expect(buildExercise(item, { fret: '99', order: 'abcd' }).fileName).toBe('exercise-spider-5-1234.gp')
  })

  it('keeps fingers, slurs and chord names in the file', () => {
    const spider = beatsOf(load(buildExercise(exercise('spider'), { fret: '5', order: '1324' }).data))
    expect(spider.slice(0, 4).map((beat) => `${beat.notes[0].fret}/${beat.notes[0].leftHandFinger}`)).toEqual(['5/1', '7/3', '6/2', '8/4'])
    // The second pass comes back down a fret higher, fingers in reverse.
    expect(spider.slice(24, 28).map((beat) => `${beat.notes[0].string}:${beat.notes[0].fret}`)).toEqual(['6:9', '6:7', '6:8', '6:6'])

    const legato = beatsOf(load(buildExercise(exercise('legato'), { fret: '5', fingers: '13' }).data))
    expect(legato.slice(0, 4).map((beat) => `${beat.notes[0].fret}${beat.notes[0].isHammerPullOrigin ? '~' : ''}`)).toEqual(['5~', '7', '7~', '5'])
    expect(legato[1].notes[0].isHammerPullDestination).toBe(true)
    expect(legato[2].notes[0].isHammerPullDestination).toBe(false)

    const chords = load(buildExercise(exercise('chord-changes'), { chords: '5', every: '4' }).data)
    const named = beatsOf(chords).filter((beat) => beat.chord).map((beat) => beat.chord!.name)
    expect(named).toEqual(['C', 'Am', 'F', 'G', 'C', 'Am', 'F', 'G'])
    expect(chords.tracks[0].staves[0].chords!.get('F')!.strings).toEqual([1, 1, 2, 3, 3, 1])
    expect(chords.masterBars).toHaveLength(8)
  })
})

describe('with the fingering suggestions', () => {
  const fingersOf = (item: Exercise, values: Record<string, string>) => {
    const score = load(buildExercise(item, values).data)
    const fingerings = trackFingerings(score.tracks[0])
    return beatsOf(score)
      .filter((beat) => beat.notes.length === 1)
      .map((beat) => fingerings?.get(beat.notes[0].id)?.finger ?? 0)
  }

  it('shows the written fingers of a finger exercise', () => {
    expect(fingersOf(exercise('spider'), { fret: '5', order: '1324' }).slice(0, 8).join('')).toBe('13241324')
  })

  it('fingers the first pentatonic box with the index finger on the lowest fret', () => {
    const item = exercise('minor-pentatonic')
    const fingers = fingersOf(item, initialValues(item)).slice(0, 12).join('')
    expect(fingers).toBe('141313131414')
  })
})
