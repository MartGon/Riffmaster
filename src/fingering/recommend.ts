/**
 * Suggests which fretting-hand finger plays each note of a tab.
 *
 * The tab already says where every note is (string and fret), so only the
 * finger is chosen. Each moment with fretted notes gets a set of possible
 * hand shapes; moving from one shape to the next has a cost for shifting
 * the hand, stretching, reusing a finger and letting go of ringing notes;
 * the cheapest path through the whole piece is the suggestion.
 * See docs/fingering-recommender.md.
 */

export type Finger = 1 | 2 | 3 | 4

export interface FingerNote {
  /** Any number that identifies the note to the caller. */
  id: number
  /** String counted from the lowest-sounding one, from 1. */
  string: number
  /** Fret counted from the nut, or from the capo; 0 is an open string. */
  fret: number
  /** Tick until which the note should stay fretted. */
  until: number
  /** True when the written length asks for it; false when it only rings on ("let ring"). */
  firm: boolean
  /** The note this one is slid into from. */
  slideFrom?: number
  /** The note this one is hammered on or pulled off from. */
  legatoFrom?: number
  bend?: boolean
  /** A finger written in the file, which is kept. */
  fixed?: Finger
}

/** The notes that start together. */
export interface FingerEvent {
  tick: number
  /** Time at the written tempo. */
  ms: number
  notes: FingerNote[]
}

export interface FingerOptions {
  capo?: number
  /** Bass: frets are further apart, so stretches low on the neck cost more. */
  bass?: boolean
}

export interface Suggestion {
  finger: Finger
  /** Fret under the index finger at that moment, counted like the notes' frets. */
  position: number
}

interface Shape {
  notes: FingerNote[]
  fingers: Finger[]
  byId: Map<number, Finger>
  /** How many of the notes start now; they come last in `notes`' source list but are flagged here. */
  isNew: boolean[]
  newCount: number
  position: number
  cost: number
}

interface State {
  shape: Shape
  total: number
  back: number
}

const WEAK = [0, 0, 0.05, 0.12, 0.4]
const BEND = [0, 1.0, 0.4, 0, 1.0]
/** A finger tucked in a fret below its own place, as when two fingers share a fret. */
const SQUEEZE = 0.4
const ROLL = 0.4
const RELEASE_FIRM = 5
const RELEASE_RINGING = 1.5
const BEAM = 48

/** Stretches are harder near the nut, where frets are widest. */
function reach(fret: number, options: Required<FingerOptions>): number {
  const actual = fret + options.capo
  const low = actual < 5 ? 1.3 : actual < 12 ? 1 : 0.8
  return options.bass ? low * 1.3 : low
}

/**
 * All ways to finger notes that are held at the same time. Fingers rise
 * with the frets, and on one fret they rise from the thicker strings to the
 * thinner ones; one finger may lie across several strings of one fret.
 */
function shapesFor(
  held: FingerNote[],
  fresh: FingerNote[],
  openStrings: number[],
  options: Required<FingerOptions>,
): Shape[] {
  const all = [...held.map((note) => ({ note, isNew: false })), ...fresh.map((note) => ({ note, isNew: true }))]
  all.sort((a, b) => a.note.fret - b.note.fret || a.note.string - b.note.string)
  const notes = all.map((entry) => entry.note)
  const isNew = all.map((entry) => entry.isNew)
  const shapes: Shape[] = []
  const fingers: Finger[] = []

  const finish = () => {
    let cost = 0
    // What each finger does: its fret, the strings it spans and how many notes it holds.
    const fretOf = [0, -1, -1, -1, -1]
    const lowString = [0, 0, 0, 0, 0]
    const highString = [0, 0, 0, 0, 0]
    const held = [0, 0, 0, 0, 0]
    for (let i = 0; i < notes.length; i++) {
      const finger = fingers[i]
      const string = notes[i].string
      if (held[finger] === 0) {
        fretOf[finger] = notes[i].fret
        lowString[finger] = string
        highString[finger] = string
      } else {
        lowString[finger] = Math.min(lowString[finger], string)
        highString[finger] = Math.max(highString[finger], string)
      }
      held[finger]++
    }
    // Stretch and squeeze between neighbouring fingers in use.
    let first = 0
    let last = 0
    for (let finger = 1; finger <= 4; finger++) {
      if (held[finger] === 0) continue
      if (last > 0) {
        const excess = fretOf[finger] - fretOf[last] - (finger - last)
        if (excess > (fretOf[last] + options.capo >= 9 ? 2 : 1)) return
        cost += excess > 0 ? 1.2 * excess * reach(fretOf[last], options) : 0.25 * -excess
      } else first = finger
      last = finger
    }
    if (last - first >= 2) {
      const excess = fretOf[last] - fretOf[first] - (last - first)
      if (excess > (fretOf[first] + options.capo >= 9 ? 2 : 1)) return
      if (excess > 0) cost += 0.6 * excess * reach(fretOf[first], options)
    }
    // Fingers sharing a fret.
    for (let i = 0; i < notes.length; ) {
      let j = i
      let different = 1
      while (j + 1 < notes.length && notes[j + 1].fret === notes[i].fret) {
        j++
        // Sorted from the thickest string: the usual way round is the lower finger on the thicker string.
        for (let k = i; k < j; k++) if (fingers[k] > fingers[j]) cost += 0.6
        if (!fingers.slice(i, j).includes(fingers[j])) different++
      }
      // Three fingertips in one fret are a tight fit.
      if (different >= 3) cost += 0.3
      i = j + 1
    }
    // A finger lying across strings.
    for (let finger = 1; finger <= 4; finger++) {
      if (held[finger] < 2) continue
      const fret = fretOf[finger]
      const low = lowString[finger]
      const high = highString[finger]
      cost += finger === 1 ? 0.15 : 0.6
      // Lying a finger down for two strings that are not neighbours is rarely worth it.
      if (held[finger] === 2 && high - low > 1) cost += 0.3
      let arched = false
      let covered = 0
      for (let i = 0; i < notes.length; i++) {
        const other = notes[i]
        const under = other.string > low && other.string < high
        if (under) covered++
        if (fingers[i] === finger) continue
        // A note fretted lower, or by a lower finger, under the lying finger cannot sound.
        if (under && (other.fret < fret || fingers[i] < finger)) return
        if (other.fret < fret && other.string > high) arched = true
      }
      for (const open of openStrings) {
        if (open > low && open < high) return
        if (open > high) arched = true
      }
      // The finger has to arch so a thinner string below its fret can sound.
      if (arched) cost += 1.0
      // In a strummed chord, a string the tab leaves out would sound under the finger.
      if (fresh.length >= 2 && covered < high - low - 1) cost += 0.5
    }
    for (let i = 0; i < notes.length; i++) {
      if (!isNew[i]) continue
      cost += WEAK[fingers[i]]
      if (notes[i].bend) cost += BEND[fingers[i]]
    }
    const chosen = fingers.slice()
    const byId = new Map(notes.map((note, i) => [note.id, chosen[i]]))
    const add = (position: number, extra: number) => {
      if (position >= 1) shapes.push({ notes, fingers: chosen, byId, isNew, newCount: fresh.length, position, cost: cost + extra })
    }
    // Where the index finger would be if each finger sat on its own fret.
    const natural = notes.map((note, i) => note.fret - (chosen[i] - 1))
    if (notes.length === 1) {
      // One finger can also sit a fret off its place: tucked in next to its
      // neighbour, or reaching out of the position.
      const stretch = reach(notes[0].fret, options)
      add(natural[0], 0)
      add(natural[0] + 1, chosen[0] === 1 ? stretch : SQUEEZE)
      add(natural[0] - 1, stretch)
    } else {
      // The shape's own stretch is already counted; the hand is anywhere its fingers allow.
      const low = Math.min(...natural)
      const high = Math.max(...natural)
      for (let position = Math.max(1, low); position <= high; position++) add(position, 0)
    }
  }

  // Fingers rise with the frets. Within one fret any finger order is tried
  // for a few notes; for more, only the usual order, to keep the count down.
  const place = (index: number, floor: number, top: number) => {
    if (index === notes.length) {
      finish()
      return
    }
    const note = notes[index]
    const startsFret = index === 0 || notes[index - 1].fret !== note.fret
    let lowest = startsFret ? top + 1 : floor
    if (!startsFret) {
      let size = 1
      for (let i = index - 1; i >= 0 && notes[i].fret === note.fret; i--) size++
      for (let i = index + 1; i < notes.length && notes[i].fret === note.fret; i++) size++
      if (size > 3) lowest = Math.max(lowest, fingers[index - 1])
    }
    for (let finger = lowest; finger <= 4; finger++) {
      if (note.fixed && note.fixed !== finger) continue
      fingers[index] = finger as Finger
      place(index + 1, startsFret ? lowest : floor, Math.max(top, finger))
    }
    fingers.length = index
  }
  place(0, 1, 0)
  return shapes
}

function shiftCost(frets: number): number {
  if (frets <= 0) return 0
  if (frets === 1) return 1
  if (frets === 2) return 1.6
  // Past a couple of frets the hand moves as a whole, and distance adds little.
  return Math.min(5, 2.2 + 0.3 * (frets - 3))
}

/** Whether `b` is the chord shape `a` on the same strings with the same fingers, some frets along. */
function isSameShapeMoved(a: Shape, b: Shape): boolean {
  if (a.notes.length < 2 || a.notes.length !== b.notes.length) return false
  let moved: number | null = null
  for (let i = 0; i < b.notes.length; i++) {
    const j = a.notes.findIndex((note) => note.string === b.notes[i].string)
    if (j < 0 || a.fingers[j] !== b.fingers[i]) return false
    const by = b.notes[i].fret - a.notes[j].fret
    if (moved !== null && by !== moved) return false
    moved = by
  }
  return moved !== 0
}

/** Cost of going from one shape to the next, with `gapMs` between them. */
function moveCost(a: Shape, b: Shape, bTick: number, gapMs: number): number {
  // A note that keeps sounding keeps its finger.
  for (let i = 0; i < b.notes.length; i++) {
    if (!b.isNew[i] && a.byId.get(b.notes[i].id) !== b.fingers[i]) return Infinity
  }
  const hurry = Math.min(2, Math.max(0.15, 250 / Math.max(1, gapMs)))
  let cost = 0
  let anchored = false
  for (const note of a.notes) {
    if (b.byId.has(note.id)) anchored = true
    else if (note.until > bTick && !b.notes.some((other) => other.string === note.string)) {
      cost += note.firm ? RELEASE_FIRM : RELEASE_RINGING
    }
  }
  let slide = false
  let legato = false
  for (let i = 0; i < b.notes.length; i++) {
    if (!b.isNew[i]) continue
    const note = b.notes[i]
    const finger = b.fingers[i]
    if (note.slideFrom !== undefined) {
      const from = a.byId.get(note.slideFrom)
      if (from !== undefined) {
        if (from === finger) slide = true
        else cost += 2.5
        continue
      }
    }
    if (note.legatoFrom !== undefined) {
      const from = a.byId.get(note.legatoFrom)
      if (from !== undefined) {
        legato = true
        // One finger cannot hammer on or pull off against itself.
        if (from === finger) cost += 8
        continue
      }
    }
    // In a single line, a finger that has to leave one note for the next breaks the flow.
    if (b.newCount !== 1) continue
    let worst = 0
    for (let j = 0; j < a.notes.length; j++) {
      const other = a.notes[j]
      if (b.byId.has(other.id)) continue
      const sameSpot = other.string === note.string && other.fret === note.fret
      if (a.fingers[j] !== finger) {
        // Swapping fingers on a note that is simply played again.
        if (sameSpot) worst = Math.max(worst, 1.2)
        continue
      }
      if (sameSpot) continue
      let penalty: number
      // Rolling a fingertip onto the next string of the same fret is the easy case.
      if (other.fret === note.fret) penalty = Math.abs(other.string - note.string) === 1 ? ROLL : 1.4 * hurry
      else if (other.string === note.string) penalty = 0.8 * hurry
      else penalty = 1.2 * hurry
      worst = Math.max(worst, penalty)
    }
    cost += worst
  }
  // With a finger staying down the hand cannot travel; the shape's own stretch covers the rest.
  if (!anchored) {
    const frets = Math.abs(b.position - a.position)
    let shift = shiftCost(frets)
    if (slide) shift *= 0.2
    // A chord shape moved along the neck as it is: the fingers do not change places.
    else if (isSameShapeMoved(a, b)) shift *= 0.35
    else if (legato) shift *= 2
    cost += shift * hurry
  }
  // One hard move matters more than several easy ones.
  return cost + 0.1 * cost * cost
}

/**
 * Chooses a finger for every fretted note. Notes for which nothing playable
 * was found (too many frets at once, for instance) are left out.
 * `events` must be in order of time.
 */
export function recommend(events: FingerEvent[], given: FingerOptions = {}): Map<number, Suggestion> {
  const options = { capo: given.capo ?? 0, bass: given.bass ?? false }
  const result = new Map<number, Suggestion>()
  /** Everything still held from earlier, oldest first; open strings too. */
  let live: FingerNote[] = []
  let steps: State[][] = []
  let previousMs = 0

  const settle = () => {
    if (steps.length === 0) return
    const lastStep = steps[steps.length - 1]
    let best = 0
    for (let i = 1; i < lastStep.length; i++) if (lastStep[i].total < lastStep[best].total) best = i
    for (let step = steps.length - 1; step >= 0; step--) {
      const state = steps[step][best]
      const shape = state.shape
      for (let i = 0; i < shape.notes.length; i++) {
        if (shape.isNew[i]) result.set(shape.notes[i].id, { finger: shape.fingers[i], position: shape.position })
      }
      best = state.back
    }
    steps = []
  }

  for (const event of events) {
    const strings = new Set(event.notes.map((note) => note.string))
    live = live.filter((note) => note.until > event.tick && !strings.has(note.string))
    const fresh = event.notes.filter((note) => note.fret > 0)
    if (fresh.length > 0) {
      const openStrings = [...live, ...event.notes].filter((note) => note.fret === 0).map((note) => note.string)
      const heldFretted = live.filter((note) => note.fret > 0)
      const previous = steps[steps.length - 1]
      // A written finger that cannot be played is dropped rather than leaving the notes without any.
      let shapes: Shape[] = []
      for (const ignoreFixed of [false, true]) {
        const notes = ignoreFixed ? fresh.map((note) => ({ ...note, fixed: undefined })) : fresh
        // Keep all the held notes, or let the oldest go one at a time.
        for (let keep = previous ? heldFretted.length : 0; keep >= 0; keep--) {
          shapes.push(...shapesFor(heldFretted.slice(heldFretted.length - keep), notes, openStrings, options))
        }
        if (shapes.length > 0 || !fresh.some((note) => note.fixed)) break
      }
      let states: State[] = []
      if (previous) {
        const gap = event.ms - previousMs
        for (const shape of shapes) {
          let total = Infinity
          let back = -1
          for (let i = 0; i < previous.length; i++) {
            const move = moveCost(previous[i].shape, shape, event.tick, gap)
            if (previous[i].total + move < total) {
              total = previous[i].total + move
              back = i
            }
          }
          if (back >= 0) states.push({ shape, total: total + shape.cost, back })
        }
      }
      if (states.length === 0) {
        // The first notes, or nothing that follows on from before: start afresh.
        settle()
        states = shapes.filter((shape) => shape.notes.length === shape.newCount).map((shape) => ({ shape, total: shape.cost, back: -1 }))
      }
      if (states.length > BEAM) {
        states.sort((a, b) => a.total - b.total)
        states.length = BEAM
      }
      if (states.length > 0) {
        steps.push(states)
        previousMs = event.ms
      } else {
        live = live.filter((note) => note.fret === 0)
      }
    }
    for (const note of event.notes) if (note.until > event.tick) live.push(note)
  }
  settle()
  return result
}
