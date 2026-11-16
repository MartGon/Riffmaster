import { describe, expect, it } from 'vitest'
import { type FingerEvent, type FingerNote, recommend } from './recommend'

let nextId = 1
/** A line of single notes, an eighth note apart at 120 bpm unless `gap` says otherwise. */
function line(places: [string: number, fret: number][], gap = 480): FingerEvent[] {
  return places.map(([string, fret], index) => ({
    tick: index * gap,
    ms: (index * gap * 500) / 960,
    notes: [{ id: nextId++, string, fret, until: (index + 1) * gap, firm: true }],
  }))
}
function chord(tick: number, frets: (number | null)[], extra: Partial<FingerNote> = {}): FingerEvent {
  // `frets` runs from the lowest string to the highest, as chords are usually written.
  const notes: FingerNote[] = []
  frets.forEach((fret, index) => {
    if (fret !== null) notes.push({ id: nextId++, string: index + 1, fret, until: tick + 1920, firm: true, ...extra })
  })
  return { tick, ms: (tick * 500) / 960, notes }
}
const fingers = (events: FingerEvent[], options = {}) => {
  const result = recommend(events, options)
  return events.map((event) => event.notes.map((note) => result.get(note.id)?.finger ?? 0))
}
const flat = (events: FingerEvent[], options = {}) => fingers(events, options).map((f) => f[0])
/** Fingers of a chord from the lowest string to the highest, 0 for open strings. */
const shape = (frets: (number | null)[]) => fingers([chord(0, frets)])[0]

describe('single lines', () => {
  it('plays a chromatic run with one finger per fret', () => {
    expect(flat(line([[6, 5], [6, 6], [6, 7], [6, 8], [5, 5], [5, 6], [5, 7], [5, 8]]))).toEqual([1, 2, 3, 4, 1, 2, 3, 4])
  })

  it('plays the minor pentatonic box in one position', () => {
    const box: [number, number][] = [[1, 5], [1, 8], [2, 5], [2, 7], [3, 5], [3, 7], [4, 5], [4, 7], [5, 5], [5, 8], [6, 5], [6, 8]]
    expect(flat(line(box))).toEqual([1, 4, 1, 3, 1, 3, 1, 3, 1, 4, 1, 4])
    expect(flat(line(box.slice().reverse()))).toEqual([4, 1, 4, 1, 3, 1, 3, 1, 3, 1, 4, 1])
  })

  it('keeps one position for a major scale', () => {
    // C major from the 8th fret of the low E string.
    expect(flat(line([[1, 8], [1, 10], [2, 7], [2, 8], [2, 10], [3, 7], [3, 9], [3, 10]]))).toEqual([2, 4, 1, 2, 4, 1, 3, 4])
  })

  it('gives open strings no finger and plays first position with fingers matching frets', () => {
    expect(flat(line([[1, 0], [1, 1], [1, 3], [2, 0], [2, 2], [2, 3]]))).toEqual([0, 1, 3, 0, 2, 3])
  })

  it('never uses the same finger for both notes of a hammer-on or pull-off', () => {
    const events = line([[3, 5], [3, 7], [3, 5], [3, 8], [3, 5]], 120)
    for (let i = 1; i < events.length; i++) events[i].notes[0].legatoFrom = events[i - 1].notes[0].id
    const result = flat(events)
    for (let i = 1; i < result.length; i++) expect(result[i]).not.toBe(result[i - 1])
    expect(result).toEqual([1, 3, 1, 4, 1])
  })

  it('keeps the finger through a slide', () => {
    const events = line([[3, 5], [3, 7], [3, 9], [3, 7]])
    events[2].notes[0].slideFrom = events[1].notes[0].id
    const result = flat(events)
    expect(result[2]).toBe(result[1])
  })

  it('moves the hand during a rest rather than during fast notes', () => {
    // Two groups a long way apart: each is played in its own position.
    const first = line([[3, 2], [3, 3], [3, 5]])
    const second = line([[3, 12], [3, 14], [3, 15]]).map((event) => ({ ...event, tick: event.tick + 7680, ms: event.ms + 4000 }))
    expect(flat([...first, ...second])).toEqual([1, 2, 4, 1, 3, 4])
  })

  it('prefers the ring finger for a bend', () => {
    const events = line([[4, 5], [4, 7], [4, 5]])
    events[1].notes[0].bend = true
    expect(flat(events)).toEqual([1, 3, 1])
  })

  it('keeps a finger written in the file and builds around it', () => {
    const events = line([[3, 5], [3, 7], [3, 8]])
    events[0].notes[0].fixed = 2
    expect(flat(events)[0]).toBe(2)
  })
})

describe('chords', () => {
  it.each([
    ['E', [0, 2, 2, 1, 0, 0], [0, 2, 3, 1, 0, 0]],
    ['A minor', [null, 0, 2, 2, 1, 0], [0, 2, 3, 1, 0]],
    ['C', [null, 3, 2, 0, 1, 0], [3, 2, 0, 1, 0]],
    ['D', [null, null, 0, 2, 3, 2], [0, 1, 3, 2]],
    ['D minor', [null, null, 0, 2, 3, 1], [0, 2, 3, 1]],
    ['G', [3, 2, 0, 0, 0, 3], [2, 1, 0, 0, 0, 3]],
    ['A', [null, 0, 2, 2, 2, 0], [0, 1, 2, 3, 0]],
    ['B7', [null, 2, 1, 2, 0, 2], [2, 1, 3, 0, 4]],
    ['F (barre)', [1, 3, 3, 2, 1, 1], [1, 3, 4, 2, 1, 1]],
    ['B minor (barre)', [null, 2, 4, 4, 3, 2], [1, 3, 4, 2, 1]],
    ['E7#9', [null, 7, 6, 7, 8, null], [2, 1, 3, 4]],
  ])('fingers %s the usual way', (_name, frets, expected) => {
    expect(shape(frets)).toEqual(expected)
  })

  it('lays one finger across a double stop', () => {
    const [a, b] = shape([null, null, null, null, 5, 5])
    expect(a).toBe(b)
  })

  it('gives no suggestion for a shape no hand can hold', () => {
    expect(shape([1, null, 9, null, null, 3])).toEqual([0, 0, 0])
    expect(shape([1, 2, 3, 4, 5, null])).toEqual([0, 0, 0, 0, 0])
  })

  it('never crosses fingers or stretches too far, whatever the chord', () => {
    // Every three-note shape within five frets on three neighbouring strings.
    for (let a = 1; a <= 5; a++) {
      for (let b = 1; b <= 5; b++) {
        for (let c = 1; c <= 5; c++) {
          const event = chord(0, [null, a, b, c, null, null])
          const result = recommend([event])
          const notes = event.notes.filter((note) => result.has(note.id))
          for (const x of notes) {
            for (const y of notes) {
              const fx = result.get(x.id)!.finger
              const fy = result.get(y.id)!.finger
              if (x.fret < y.fret) expect(fx).toBeLessThan(fy)
              if (x.fret === y.fret && x.string < y.string) expect(fx).toBeLessThanOrEqual(fy)
              if (fx < fy) expect(y.fret - x.fret - (fy - fx)).toBeLessThanOrEqual(1)
            }
          }
        }
      }
    }
  })
})

describe('chords in a row', () => {
  it('moves a power chord along the neck without changing fingers', () => {
    // Root and fifth on the two lowest strings, an eighth note apart.
    const events = [[3, 5], [5, 7], [6, 8], [1, 3], [3, 5]].map(([root, fifth], i) => chord(i * 240, [root, fifth]))
    const result = fingers(events)
    for (const pair of result) expect(pair).toEqual(result[0])
    expect(result[0][0]).toBe(1)
  })

  it('moves a one-finger chord in drop D as one finger', () => {
    const events = [5, 7, 3, 5].map((fret, i) => chord(i * 480, [fret, fret, fret]))
    expect(fingers(events)).toEqual([[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]])
  })

  it('does not lay a finger over a string the chord leaves out', () => {
    // G major 7 as 3x443x: a finger across strings 6 to 2 would sound the A string.
    const [low, , , high] = shape([3, null, 4, 4, 3, null])
    expect(low).not.toBe(high)
  })

  it('holds one note of a double stop while the other slides away', () => {
    const first = chord(0, [null, null, null, null, 5, 5])
    first.notes[1].until = 960
    const second: FingerEvent = { tick: 480, ms: 250, notes: [{ id: nextId++, string: 5, fret: 8, until: 960, firm: true, slideFrom: first.notes[0].id }] }
    const result = recommend([first, second])
    const held = result.get(first.notes[1].id)!.finger
    const slid = result.get(first.notes[0].id)!.finger
    expect(slid).not.toBe(held)
    expect(result.get(second.notes[0].id)!.finger).toBe(slid)
  })
})

describe('size of the search', () => {
  it('stays quick for hundreds of full chords left ringing', () => {
    const events: FingerEvent[] = []
    for (let i = 0; i < 1500; i++) {
      const frets = i % 2 ? [3, 5, 5, 4, 3, 3] : [1, 3, 3, 2, 1, 1]
      events.push(chord(i * 240, frets, { firm: false }))
    }
    const started = performance.now()
    const result = recommend(events)
    expect(performance.now() - started).toBeLessThan(1000)
    expect(result.size).toBe(1500 * 6)
  })
})

describe('ringing notes', () => {
  it('fingers an arpeggio as the chord it spells', () => {
    // A minor, one note at a time, each left ringing.
    const places: [number, number][] = [[2, 0], [3, 2], [4, 2], [5, 1], [4, 2], [3, 2]]
    const events = line(places)
    for (const event of events) {
      event.notes[0].until = 480 * 8
      event.notes[0].firm = false
    }
    // A string struck again lets go of its earlier note.
    events[2].notes[0].until = events[4].tick
    events[1].notes[0].until = events[5].tick
    expect(flat(events)).toEqual([0, 2, 3, 1, 3, 2])
  })

  it('holds a bass note under a melody when the tab writes it that long', () => {
    const bass: FingerEvent = { tick: 0, ms: 0, notes: [{ id: nextId++, string: 2, fret: 3, until: 1920, firm: true }] }
    const melody = line([[5, 1], [5, 3], [4, 2], [5, 1]]).map((event) => ({ ...event, tick: event.tick + 240, ms: event.ms + 125 }))
    const result = recommend([bass, ...melody])
    // C on the A string with the third finger leaves 1, 2 and 4 for the tune.
    expect(result.get(bass.notes[0].id)?.finger).toBe(3)
    expect(melody.map((event) => result.get(event.notes[0].id)?.finger)).toEqual([1, 4, 2, 1])
  })

  it('lets go of ringing notes when the next chord cannot be reached with them down', () => {
    const first = chord(0, [null, null, null, 2, 1, null], { firm: false })
    const second = chord(480, [null, null, 9, null, null, 10], { firm: false })
    const result = recommend([first, second])
    for (const note of [...first.notes, ...second.notes]) expect(result.has(note.id)).toBe(true)
  })
})

describe('instrument', () => {
  it('counts frets from the capo', () => {
    expect(flat(line([[1, 1], [1, 2], [1, 3], [1, 4]]), { capo: 5 })).toEqual([1, 2, 3, 4])
  })

  it('handles a bass line', () => {
    const result = flat(line([[1, 3], [1, 5], [2, 2], [2, 3], [2, 5], [3, 2], [3, 4], [3, 5]]), { bass: true })
    expect(result).toEqual([2, 4, 1, 2, 4, 1, 3, 4])
  })
})
