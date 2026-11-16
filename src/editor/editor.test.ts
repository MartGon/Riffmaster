import * as alphaTab from '@coderline/alphatab'
import { describe, expect, it } from 'vitest'
import { barTicks, defaultRhythm, describeFill, describeTicks, fillValues, rhythmTicks, stepValue } from './duration'
import { type Cursor, type Edit, EditHistory } from './history'
import { createSong, INSTRUMENTS } from './newSong'
import {
  addTrack,
  appendBeat,
  barFill,
  beatAt,
  beatRhythm,
  copyBars,
  deleteBars,
  deleteBeat,
  deleteNote,
  deleteTrack,
  fillBar,
  flagProblem,
  insertBars,
  insertBeat,
  makeRest,
  noteAt,
  pasteBars,
  setBeatRhythm,
  setFret,
  setRepeatEnd,
  setSection,
  setSongInfo,
  setTimeSignature,
  setTrackInfo,
  toggleFlag,
  toggleRepeatStart,
} from './ops'
import { rebuild, serialize } from './tree'

const settings = new alphaTab.Settings()

// The app's type settings have no Node types, so the file system is reached
// through a plain dynamic import. Used only for the optional sample file.
const fsModule = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsModule)) as {
  existsSync(path: URL): boolean
  readFileSync(path: URL): Uint8Array
}

function newScore(bars = 4, instrument = INSTRUMENTS[0]) {
  const bytes = createSong({ title: 'Test', artist: 'Me', instrument, tempo: 100, numerator: 4, denominator: 4, bars }, settings)
  return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
}

/** Applies edits one after another, as the editor does. */
function run(score: alphaTab.model.Score, history: EditHistory, make: (score: alphaTab.model.Score) => Edit | null, cursor: Cursor) {
  const edit = make(score)
  if (!edit) throw new Error('edit was refused')
  return history.commit(score, edit, cursor)
}

const at = (bar: number, beat: number, string = 6): Cursor => ({ track: 0, bar, beat, string })

function frets(score: alphaTab.model.Score, bar: number): string {
  return score.tracks[0].staves[0].bars[bar].voices[0].beats
    .map((beat) => (beat.isEmpty ? 'empty' : beat.notes.length === 0 ? `r${beat.duration}` : beat.notes.map((n) => `${n.string}:${n.fret}`).join('+')))
    .join(' ')
}

describe('note lengths', () => {
  it('counts ticks', () => {
    expect(rhythmTicks({ value: 4, dots: 0, triplet: false })).toBe(960)
    expect(rhythmTicks({ value: 8, dots: 1, triplet: false })).toBe(720)
    expect(rhythmTicks({ value: 8, dots: 0, triplet: true })).toBe(320)
    expect(barTicks(6, 8)).toBe(2880)
  })
  it('describes what a bar is missing', () => {
    expect(describeTicks(480)).toBe('1 eighth note')
    expect(describeTicks(1440)).toBe('3 eighth notes')
    expect(describeTicks(320)).toBe('1 triplet eighth note')
    expect(describeFill(3360, 3840)).toBe('Bar is 1 eighth note short')
    expect(describeFill(4800, 3840)).toBe('Bar is 1 quarter note too long')
    expect(describeFill(0, 3840)).toBe('Empty bar')
    expect(describeFill(3840, 3840)).toBeNull()
  })
  it('fills with the longest values first', () => {
    expect(fillValues(3840 - 480)).toEqual([2, 4, 8])
    expect(stepValue(4, 1)).toBe(8)
    expect(stepValue(1, -1)).toBe(1)
  })
})

describe('a new song', () => {
  it('has the chosen instrument, tempo and empty bars', () => {
    const score = newScore(8, INSTRUMENTS[3])
    expect(score.title).toBe('Test')
    expect(score.tempo).toBe(100)
    expect(score.masterBars).toHaveLength(8)
    expect(score.tracks[0].staves[0].tuning).toEqual([43, 38, 33, 28])
    expect(score.tracks[0].playbackInfo.program).toBe(33)
    expect(frets(score, 0)).toBe('empty')
  })
})

describe('editing notes', () => {
  it('writes frets, and undo and redo restore each state', () => {
    const history = new EditHistory(settings)
    let score = newScore()
    expect(history.dirty).toBe(false)
    ;({ score } = run(score, history, (s) => setFret(s, at(0, 0), 5, { value: 8, dots: 0, triplet: false }), at(0, 0)))
    expect(frets(score, 0)).toBe('6:5')
    expect(score.tracks[0].staves[0].bars[0].voices[0].beats[0].duration).toBe(8)
    ;({ score } = run(score, history, (s) => setFret(s, at(0, 0, 5), 7, defaultRhythm), at(0, 0, 5)))
    expect(frets(score, 0)).toBe('6:5+5:7')
    expect(history.dirty).toBe(true)

    score = history.undo(score)!.score
    expect(frets(score, 0)).toBe('6:5')
    score = history.undo(score)!.score
    expect(frets(score, 0)).toBe('empty')
    expect(history.dirty).toBe(false)
    expect(history.undo(score)).toBeNull()
    score = history.redo(score)!.score
    score = history.redo(score)!.score
    expect(frets(score, 0)).toBe('6:5+5:7')
    expect(history.redo(score)).toBeNull()
  })

  it('folds a second digit into the same undo step', () => {
    const history = new EditHistory(settings)
    let score = newScore()
    ;({ score } = history.commit(score, setFret(score, at(0, 0), 1, defaultRhythm)!, at(0, 0), { mergeKey: 'x' }))
    expect(history.mergeKey).toBe('x')
    ;({ score } = history.commit(score, setFret(score, at(0, 0), 12, defaultRhythm)!, at(0, 0), { mergeWithLast: true }))
    expect(frets(score, 0)).toBe('6:12')
    expect(history.mergeKey).toBeUndefined()
    score = history.undo(score)!.score
    expect(frets(score, 0)).toBe('empty')
  })

  it('deletes notes, makes rests and changes lengths', () => {
    const history = new EditHistory(settings)
    let score = newScore()
    ;({ score } = run(score, history, (s) => setFret(s, at(0, 0), 3, defaultRhythm), at(0, 0)))
    ;({ score } = run(score, history, (s) => setFret(s, at(0, 0, 4), 2, defaultRhythm), at(0, 0)))
    ;({ score } = run(score, history, (s) => deleteNote(s, at(0, 0, 4)), at(0, 0)))
    expect(frets(score, 0)).toBe('6:3')
    expect(deleteNote(score, at(0, 0, 4))).toBeNull()
    ;({ score } = run(score, history, (s) => setBeatRhythm(s, at(0, 0), { value: 2, dots: 1, triplet: false }), at(0, 0)))
    expect(barFill(score, 0, 0)).toEqual({ used: 2880, length: 3840 })
    ;({ score } = run(score, history, (s) => makeRest(s, at(0, 0)), at(0, 0)))
    expect(frets(score, 0)).toBe('r2')
  })

  it('adds, inserts and deletes beats, and fills a bar with rests', () => {
    const history = new EditHistory(settings)
    let score = newScore()
    ;({ score } = run(score, history, (s) => setFret(s, at(0, 0), 1, defaultRhythm), at(0, 0)))
    let cursor: Cursor
    ;({ score, cursor } = run(score, history, (s) => appendBeat(s, at(0, 0), defaultRhythm), at(0, 0)))
    expect(cursor.beat).toBe(1)
    ;({ score } = run(score, history, (s) => setFret(s, at(0, 1), 2, defaultRhythm), at(0, 1)))
    ;({ score } = run(score, history, (s) => insertBeat(s, at(0, 1), { value: 8, dots: 0, triplet: false }), at(0, 1)))
    expect(frets(score, 0)).toBe('6:1 r8 6:2')
    ;({ score } = run(score, history, (s) => fillBar(s, at(0, 0)), at(0, 0)))
    expect(barFill(score, 0, 0)).toEqual({ used: 3840, length: 3840 })
    expect(fillBar(score, at(0, 0))).toBeNull()
    ;({ score } = run(score, history, (s) => deleteBeat(s, at(0, 0)), at(0, 0)))
    expect(frets(score, 0).startsWith('r8 6:2')).toBe(true)
  })

  it('switches techniques on and off and steps through bends', () => {
    const history = new EditHistory(settings)
    let score = newScore()
    ;({ score } = run(score, history, (s) => setFret(s, at(0, 0, 3), 7, defaultRhythm), at(0, 0)))
    ;({ score } = run(score, history, (s) => appendBeat(s, at(0, 0), defaultRhythm), at(0, 0)))
    ;({ score } = run(score, history, (s) => setFret(s, at(0, 1, 3), 9, defaultRhythm), at(0, 1)))
    ;({ score } = run(score, history, (s) => toggleFlag(s, at(0, 0, 3), 'hammer'), at(0, 0)))
    expect(noteAt(score, at(0, 0, 3))!.isHammerPullOrigin).toBe(true)
    expect(noteAt(score, at(0, 0, 3))!.hammerPullDestination).toBe(noteAt(score, at(0, 1, 3)))
    ;({ score } = run(score, history, (s) => toggleFlag(s, at(0, 1, 3), 'bend'), at(0, 1)))
    expect(noteAt(score, at(0, 1, 3))!.hasBend).toBe(true)
    ;({ score } = run(score, history, (s) => toggleFlag(s, at(0, 1, 3), 'bend'), at(0, 1)))
    expect(Math.max(...noteAt(score, at(0, 1, 3))!.bendPoints!.map((p) => p.value))).toBe(4)
    ;({ score } = run(score, history, (s) => toggleFlag(s, at(0, 1, 3), 'bend'), at(0, 1)))
    expect(noteAt(score, at(0, 1, 3))!.hasBend).toBe(false)
    for (const flag of ['slide', 'vibrato', 'dead', 'ghost', 'palmMute', 'letRing', 'accent'] as const) {
      ;({ score } = run(score, history, (s) => toggleFlag(s, at(0, 0, 3), flag), at(0, 0)))
    }
    const note = noteAt(score, at(0, 0, 3))!
    expect([note.isDead, note.isGhost, note.isPalmMute, note.isLetRing, note.vibrato > 0, note.accentuated > 0]).toEqual([true, true, true, true, true, true])
    expect(toggleFlag(score, at(0, 0, 1), 'hammer')).toBeNull()
    // A hammer-on, slide or tie that has no note to connect to is refused with a reason.
    expect(flagProblem(score, at(0, 1, 3), 'hammer')).toMatch(/following note/)
    expect(flagProblem(score, at(0, 1, 3), 'slide')).toMatch(/following note/)
    expect(flagProblem(score, at(0, 0, 3), 'tie')).toMatch(/earlier note/)
    expect(flagProblem(score, at(0, 1, 3), 'tie')).toBeNull()
    expect(flagProblem(score, at(0, 0, 3), 'hammer')).toBeNull()
  })

  it('keeps ties working, and survives deleting the tied-from note', () => {
    const history = new EditHistory(settings)
    let score = newScore()
    ;({ score } = run(score, history, (s) => setFret(s, at(0, 0, 2), 5, { value: 1, dots: 0, triplet: false }), at(0, 0)))
    ;({ score } = run(score, history, (s) => setFret(s, at(1, 0, 2), 0, defaultRhythm), at(1, 0)))
    ;({ score } = run(score, history, (s) => toggleFlag(s, at(1, 0, 2), 'tie'), at(1, 0)))
    const tied = noteAt(score, at(1, 0, 2))!
    expect(tied.isTieDestination).toBe(true)
    expect(tied.fret).toBe(5)
    expect(tied.tieOrigin).toBe(noteAt(score, at(0, 0, 2)))
    ;({ score } = run(score, history, (s) => deleteNote(s, at(0, 0, 2)), at(0, 0)))
    expect(noteAt(score, at(1, 0, 2))!.isTieDestination).toBe(false)
    score = history.undo(score)!.score
    expect(noteAt(score, at(1, 0, 2))!.tieOrigin).toBe(noteAt(score, at(0, 0, 2)))
  })
})

describe('editing bars', () => {
  it('inserts and deletes bars in every track, undoably', () => {
    const history = new EditHistory(settings)
    let score = newScore(3)
    ;({ score } = run(score, history, (s) => addTrack(s, { name: 'Bass', tuning: INSTRUMENTS[3].tuning, program: 33 }, at(0, 0)), at(0, 0)))
    expect(score.tracks).toHaveLength(2)
    expect(score.tracks[1].playbackInfo.primaryChannel).toBe(2)
    ;({ score } = run(score, history, (s) => setFret(s, at(1, 0), 9, defaultRhythm), at(1, 0)))
    ;({ score } = run(score, history, (s) => insertBars(s, 1, 2, at(0, 0)), at(0, 0)))
    expect(score.masterBars).toHaveLength(5)
    expect(score.tracks.map((t) => t.staves[0].bars.length)).toEqual([5, 5])
    expect(frets(score, 3)).toBe('6:9')
    ;({ score } = run(score, history, (s) => deleteBars(s, 0, 1, at(0, 0)), at(0, 0)))
    expect(score.masterBars).toHaveLength(4)
    score = history.undo(score)!.score
    score = history.undo(score)!.score
    expect(score.masterBars).toHaveLength(3)
    expect(frets(score, 1)).toBe('6:9')
    score = history.redo(score)!.score
    expect(frets(score, 3)).toBe('6:9')
    expect(deleteBars(score, 0, 5, at(0, 0))).toBeNull()
    ;({ score } = run(score, history, (s) => deleteTrack(s, 1, at(0, 0)), at(0, 0)))
    expect(score.tracks).toHaveLength(1)
    score = history.undo(score)!.score
    expect(score.tracks).toHaveLength(2)
  })

  it('changes the time signature up to the next change', () => {
    const history = new EditHistory(settings)
    let score = newScore(5)
    ;({ score } = run(score, history, (s) => setTimeSignature(s, 3, 6, 8, at(0, 0)), at(0, 0)))
    ;({ score } = run(score, history, (s) => setTimeSignature(s, 1, 3, 4, at(0, 0)), at(0, 0)))
    expect(score.masterBars.map((m) => `${m.timeSignatureNumerator}/${m.timeSignatureDenominator}`)).toEqual(['4/4', '3/4', '3/4', '6/8', '6/8'])
    score = history.undo(score)!.score
    expect(score.masterBars[1].timeSignatureNumerator).toBe(4)
  })

  it('sets repeats, sections and song details', () => {
    const history = new EditHistory(settings)
    let score = newScore(4)
    ;({ score } = run(score, history, (s) => toggleRepeatStart(s, 1, at(0, 0)), at(0, 0)))
    ;({ score } = run(score, history, (s) => setRepeatEnd(s, 2, 3, at(0, 0)), at(0, 0)))
    ;({ score } = run(score, history, (s) => setSection(s, 1, 'Verse', at(0, 0)), at(0, 0)))
    ;({ score } = run(score, history, (s) => setSongInfo(s, { title: 'New', artist: 'Band', tempo: 140 }, at(0, 0)), at(0, 0)))
    expect(score.masterBars[1].isRepeatStart).toBe(true)
    expect(score.masterBars[2].repeatCount).toBe(3)
    expect(score.masterBars[1].section?.text).toBe('Verse')
    expect([score.title, score.artist, score.tempo]).toEqual(['New', 'Band', 140])
    expect(setSection(score, 1, ' Verse ', at(0, 0))).toBeNull()
    ;({ score } = run(score, history, (s) => setSection(s, 1, '', at(0, 0)), at(0, 0)))
    expect(score.masterBars[1].section).toBeNull()
    score = history.undo(score)!.score
    score = history.undo(score)!.score
    expect([score.title, score.tempo]).toEqual(['Test', 100])
  })

  it('changes tuning and capo but not the string count', () => {
    const history = new EditHistory(settings)
    let score = newScore(2)
    const dropD = [64, 59, 55, 50, 45, 38]
    ;({ score } = run(score, history, (s) => setTrackInfo(s, 0, { name: 'Lead', tuning: dropD, capo: 2 }, at(0, 0)), at(0, 0)))
    expect(score.tracks[0].name).toBe('Lead')
    expect(score.tracks[0].staves[0].tuning).toEqual(dropD)
    expect(score.tracks[0].staves[0].capo).toBe(2)
    expect(setTrackInfo(score, 0, { name: 'Lead', tuning: [64, 59, 55, 50], capo: 0 }, at(0, 0))).toBeNull()
    score = history.undo(score)!.score
    expect(score.tracks[0].staves[0].tuning).toEqual(INSTRUMENTS[0].tuning)
  })

  it('copies and pastes bars, dropping strings the track lacks', () => {
    const history = new EditHistory(settings)
    let score = newScore(4, INSTRUMENTS[0])
    ;({ score } = run(score, history, (s) => setFret(s, at(0, 0, 6), 3, defaultRhythm), at(0, 0)))
    ;({ score } = run(score, history, (s) => setFret(s, at(0, 0, 1), 5, defaultRhythm), at(0, 0)))
    ;({ score } = run(score, history, (s) => setFret(s, at(1, 0, 2), 7, defaultRhythm), at(1, 0)))
    const clip = copyBars(serialize(score), 0, 0, 1)!
    expect(clip.bars).toHaveLength(2)
    ;({ score } = run(score, history, (s) => pasteBars(s, at(2, 0), clip), at(2, 0)))
    expect(frets(score, 2)).toBe(frets(score, 0))
    expect(frets(score, 3)).toBe('2:7')
    // Pasting past the end only fills the bars that exist.
    ;({ score } = run(score, history, (s) => pasteBars(s, at(3, 0), clip), at(3, 0)))
    expect(frets(score, 3)).toBe(frets(score, 0))
    // Beat ids stay unique, which alphaTab relies on to find beats on screen.
    const ids = score.tracks[0].staves[0].bars.flatMap((bar) => bar.voices[0].beats.map((beat) => beat.id))
    expect(new Set(ids).size).toBe(ids.length)
    ;({ score } = run(score, history, (s) => addTrack(s, { name: 'Bass', tuning: INSTRUMENTS[3].tuning, program: 33 }, at(0, 0)), at(0, 0)))
    ;({ score } = run(score, history, (s) => pasteBars(s, { track: 1, bar: 0, beat: 0, string: 1 }, clip), at(0, 0)))
    const bassBeat = beatAt(score, { track: 1, bar: 0, beat: 0, string: 1 })!
    expect(bassBeat.notes.map((n) => `${n.string}:${n.fret}`)).toEqual(['1:5'])
  })
})

describe('rebuilding a real song', () => {
  const sample = new URL('../../samples/californication.gp', import.meta.url)
  it.skipIf(!fs.existsSync(sample))('keeps every note, tie, slide and legato mark', () => {
    const original = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(fs.readFileSync(sample)), settings)
    const describe = (score: alphaTab.model.Score) => {
      const parts: string[] = []
      for (const track of score.tracks) {
        for (const staff of track.staves) {
          for (const bar of staff.bars) {
            for (const voice of bar.voices) {
              for (const beat of voice.beats) {
                parts.push(`${beat.duration}.${beat.dots}.${beat.playbackStart}.${beat.playbackDuration}`)
                for (const note of beat.notes) {
                  parts.push(`${note.string}:${note.fret}:${!!note.tieOrigin}:${!!note.hammerPullDestination}:${!!note.slideTarget}:${note.isLetRing}`)
                }
              }
            }
          }
        }
      }
      return parts.join('|')
    }
    const rebuilt = rebuild(serialize(original), settings)
    expect(describe(rebuilt)).toBe(describe(original))
  })
})

describe('defects found in review', () => {
  /** Everything about the notes that undo must bring back exactly. */
  const fingerprint = (score: alphaTab.model.Score) =>
    score.tracks
      .flatMap((track) => track.staves.flatMap((staff) => staff.bars))
      .flatMap((bar) => bar.voices.flatMap((voice) => voice.beats))
      .map((beat) => `${beat.duration}:${beat.notes.map((n) => `${n.string}/${n.fret}/${n.slideOutType}/${n.isTieDestination}/${n.isHammerPullOrigin}`).join(',')}`)
      .join('|') + `#${score.masterBars.length}#${score.tempo}`

  /** Bar 1 ends with a slide and a hammer-on into bar 2, and a tie runs from bar 2 into bar 3. */
  function linkedSong() {
    const history = new EditHistory(settings)
    let score = newScore(4)
    const half = { value: 2, dots: 0, triplet: false } as const
    ;({ score } = run(score, history, (s) => setFret(s, at(0, 0, 3), 5, half), at(0, 0)))
    ;({ score } = run(score, history, (s) => appendBeat(s, at(0, 0), half), at(0, 0)))
    ;({ score } = run(score, history, (s) => setFret(s, at(0, 1, 3), 7, half), at(0, 1)))
    ;({ score } = run(score, history, (s) => setFret(s, at(0, 1, 2), 2, half), at(0, 1)))
    ;({ score } = run(score, history, (s) => setFret(s, at(1, 0, 3), 9, { value: 1, dots: 0, triplet: false }), at(1, 0)))
    ;({ score } = run(score, history, (s) => setFret(s, at(1, 0, 2), 4, { value: 1, dots: 0, triplet: false }), at(1, 0)))
    ;({ score } = run(score, history, (s) => toggleFlag(s, at(0, 1, 3), 'slide'), at(0, 1)))
    ;({ score } = run(score, history, (s) => toggleFlag(s, at(0, 1, 2), 'hammer'), at(0, 1)))
    ;({ score } = run(score, history, (s) => setFret(s, at(2, 0, 3), 0, { value: 1, dots: 0, triplet: false }), at(2, 0)))
    ;({ score } = run(score, history, (s) => toggleFlag(s, at(2, 0, 3), 'tie'), at(2, 0)))
    expect(noteAt(score, at(0, 1, 3))!.slideOutType).toBe(alphaTab.model.SlideOutType.Shift)
    expect(noteAt(score, at(0, 1, 2))!.isHammerPullOrigin).toBe(true)
    expect(noteAt(score, at(2, 0, 3))!.isTieDestination).toBe(true)
    return { history, score }
  }

  it('undoing a bar insert or delete restores slides, hammer-ons and ties around it', () => {
    let { history, score } = linkedSong()
    const original = fingerprint(score)
    for (const make of [
      (s: alphaTab.model.Score) => insertBars(s, 1, 1, at(0, 0)),
      (s: alphaTab.model.Score) => deleteBars(s, 1, 1, at(0, 0)),
      (s: alphaTab.model.Score) => deleteBars(s, 0, 2, at(0, 0)),
      (s: alphaTab.model.Score) => insertBars(s, 0, 3, at(0, 0)),
    ]) {
      ;({ score } = run(score, history, make, at(0, 0)))
      expect(fingerprint(score)).not.toBe(original)
      score = history.undo(score)!.score
      expect(fingerprint(score)).toBe(original)
      score = history.redo(score)!.score
      score = history.undo(score)!.score
      expect(fingerprint(score)).toBe(original)
    }
  })

  it('deleting the note a tie starts from unties the held note instead of re-pitching it', () => {
    let { history, score } = linkedSong()
    // Another note on the same string earlier on, which the tie must not jump to.
    ;({ score } = run(score, history, (s) => deleteNote(s, at(1, 0, 3)), at(1, 0)))
    const held = noteAt(score, at(2, 0, 3))!
    expect(held.isTieDestination).toBe(false)
    expect(held.fret).toBe(9)
    score = history.undo(score)!.score
    expect(noteAt(score, at(2, 0, 3))!.isTieDestination).toBe(true)
    // The same for a whole beat removed or turned into a rest.
    ;({ score } = run(score, history, (s) => makeRest(s, at(1, 0)), at(1, 0)))
    expect(noteAt(score, at(2, 0, 3))!.isTieDestination).toBe(false)
    score = history.undo(score)!.score
    ;({ score } = run(score, history, (s) => deleteBeat(s, at(1, 0)), at(1, 0)))
    expect(noteAt(score, at(2, 0, 3))!.isTieDestination).toBe(false)
  })

  it('keeps the tempo when the first bar is deleted or a bar is put before it', () => {
    const history = new EditHistory(settings)
    let score = newScore(4)
    ;({ score } = run(score, history, (s) => deleteBars(s, 0, 1, at(0, 0)), at(0, 0)))
    expect(score.tempo).toBe(100)
    ;({ score } = run(score, history, (s) => insertBars(s, 0, 1, at(0, 0)), at(0, 0)))
    expect(score.tempo).toBe(100)
    expect(score.masterBars.slice(1).every((bar) => bar.tempoAutomations.length === 0)).toBe(true)
    ;({ score } = run(score, history, (s) => setSongInfo(s, { title: 'Test', artist: 'Me', tempo: 80 }, at(0, 0)), at(0, 0)))
    expect(score.masterBars.map((bar) => bar.tempoAutomations.map((a) => a.value))).toEqual([[80], [], [], []])
  })

  it('counts the song as changed after more steps than undo keeps', () => {
    const history = new EditHistory(settings)
    let score = newScore(1)
    for (let i = 0; i < 201; i++) {
      ;({ score } = history.commit(score, setFret(score, at(0, 0), i % 2 ? 3 : 4, defaultRhythm)!, at(0, 0)))
    }
    while (history.canUndo) score = history.undo(score)!.score
    expect(history.dirty).toBe(true)
  })

  it('does not join a digit to one that was undone', () => {
    const history = new EditHistory(settings)
    let score = newScore(1)
    ;({ score } = history.commit(score, setFret(score, at(0, 0), 9, defaultRhythm)!, at(0, 0), { mergeKey: 'k' }))
    ;({ score } = history.commit(score, setFret(score, at(0, 0), 1, defaultRhythm)!, at(0, 0), { mergeKey: 'k' }))
    score = history.undo(score)!.score
    expect(history.mergeKey).toBeUndefined()
  })

  it('keeps other tuplets when a beat is dotted, and adds up tuplet bars despite rounding', () => {
    const history = new EditHistory(settings)
    let score = newScore(1)
    ;({ score } = run(score, history, (s) => setFret(s, at(0, 0), 1, { value: 16, dots: 0, triplet: false, tuplet: [5, 4] }), at(0, 0)))
    const rhythm = beatRhythmOf(score)
    expect(rhythm.tuplet).toEqual([5, 4])
    ;({ score } = run(score, history, (s) => setBeatRhythm(s, at(0, 0), { ...rhythm, dots: 1 }), at(0, 0)))
    const beat = beatAt(score, at(0, 0))!
    expect([beat.tupletNumerator, beat.tupletDenominator, beat.dots]).toEqual([5, 4, 1])
    expect(describeFill(3839.999999999998, 3840)).toBeNull()
    expect(describeFill(3840.0000000000014, 3840)).toBeNull()
  })
})

function beatRhythmOf(score: alphaTab.model.Score) {
  return beatRhythm(beatAt(score, { track: 0, bar: 0, beat: 0, string: 1 })!)
}
