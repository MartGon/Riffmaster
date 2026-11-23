import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bestKey,
  buildTargets,
  DEFAULT_SETTINGS,
  difficultyFactor,
  FindNoteGame,
  type FindNoteTarget,
  GAME_TUNINGS,
  loadFindNote,
  mergeBest,
  NOTE_LIMIT_SEC,
  notePoints,
  saveFindNote,
  speedShare,
  stringLabel,
  summarize,
  zoneLabel,
} from './findNote'

const seeded = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 2 ** 32
}
const target = (midi: number, fret = 5): FindNoteTarget => ({ string: 0, fret, midi })

describe('find the note: the notes', () => {
  it('keeps to natural notes and the chosen frets', () => {
    const targets = buildTargets({ ...DEFAULT_SETTINGS, notes: 'natural', neck: 'first', rounds: 30 }, seeded(1))
    expect(targets).toHaveLength(30)
    for (const item of targets) {
      expect([0, 2, 4, 5, 7, 9, 11]).toContain(item.midi % 12)
      expect(item.fret).toBeGreaterThanOrEqual(1)
      expect(item.fret).toBeLessThanOrEqual(5)
      expect(item.midi).toBe(GAME_TUNINGS[0].open[item.string] + item.fret)
    }
  })

  it('never asks for the same pitch twice in a row', () => {
    for (let seed = 1; seed < 30; seed++) {
      const targets = buildTargets({ ...DEFAULT_SETTINGS, neck: 'first', rounds: 30 }, seeded(seed))
      for (let i = 1; i < targets.length; i++) expect(targets[i].midi).not.toBe(targets[i - 1].midi)
    }
  })

  it('uses every place before using one again', () => {
    const targets = buildTargets({ ...DEFAULT_SETTINGS, notes: 'all', neck: 'first', rounds: 30 }, seeded(4))
    expect(new Set(targets.map((item) => `${item.string}:${item.fret}`)).size).toBe(30)
  })

  it('reaches past fret 12 on the full neck, and says so', () => {
    const targets = buildTargets({ ...DEFAULT_SETTINGS, notes: 'all', neck: 'full', rounds: 30 }, seeded(2))
    const high = targets.find((item) => item.fret > 12)!
    expect(zoneLabel(high, 'full')).toBe('above the 12th fret')
    expect(zoneLabel(target(50, 12), 'full')).toBe('up to the 12th fret')
  })

  it('keeps to the frets a bass has', () => {
    const targets = buildTargets({ ...DEFAULT_SETTINGS, tuning: 'bass', notes: 'all', neck: 'full', rounds: 30 }, seeded(3))
    for (let seed = 1; seed < 20; seed++) {
      for (const item of buildTargets({ ...DEFAULT_SETTINGS, tuning: 'bass', notes: 'all', neck: 'full', rounds: 30 }, seeded(seed))) expect(item.fret).toBeLessThanOrEqual(20)
    }
    expect(targets).toHaveLength(30)
  })

  it('names strings as guitarists do', () => {
    const open = GAME_TUNINGS[0].open
    expect(stringLabel(open, 0)).toBe('6th string (low E)')
    expect(stringLabel(open, 5)).toBe('1st string (high E)')
    expect(stringLabel(open, 3)).toBe('3rd string (G)')
  })
})

describe('find the note: the score', () => {
  it('gives full speed marks up to a second, then less', () => {
    expect(speedShare(0.4)).toBe(1)
    expect(speedShare(1)).toBe(1)
    expect(speedShare(4)).toBeLessThan(1)
    expect(speedShare(NOTE_LIMIT_SEC)).toBeCloseTo(0.2)
  })

  it('takes points off for wrong notes, and adds them for a streak and difficulty', () => {
    expect(notePoints(1, 0, 0, 1)).toBe(100)
    expect(notePoints(1, 1, 0, 1)).toBe(75)
    expect(notePoints(1, 9, 0, 1)).toBe(25)
    expect(notePoints(1, 0, 3, 1)).toBe(130)
    expect(notePoints(1, 0, 40, 1)).toBe(150)
    expect(difficultyFactor({ notes: 'all', neck: 'full' })).toBeGreaterThan(difficultyFactor({ notes: 'natural', neck: 'first' }))
  })

  it('sums up a game', () => {
    const summary = summarize(
      [
        { target: target(45), found: true, seconds: 1, wrong: 0, points: 100 },
        { target: target(47), found: true, seconds: 2, wrong: 1, points: 60 },
        { target: target(48), found: false, seconds: null, wrong: 0, points: 0 },
      ],
      1,
    )
    expect(summary.found).toBe(2)
    expect(summary.clean).toBe(1)
    expect(summary.accuracy).toBeCloseTo(1 / 3)
    expect(summary.averageSec).toBeCloseTo(1.5)
    expect(summary.worst.map((item) => item.target.midi)).toEqual([48, 47])
  })
})

describe('find the note: a game', () => {
  it('counts the time from the prompt to the note', () => {
    const game = new FindNoteGame([target(45)], 1)
    game.ask(10)
    const result = game.hear({ timeSec: 11.5, midi: [45] })
    expect(result?.seconds).toBeCloseTo(1.5)
    expect(game.finished).toBe(true)
  })

  it('ignores what was played before the prompt, or too soon to be an answer', () => {
    const game = new FindNoteGame([target(45)], 1)
    game.ask(10)
    expect(game.hear({ timeSec: 9.9, midi: [45] })).toBeNull()
    expect(game.hear({ timeSec: 10.05, midi: [45] })).toBeNull()
    expect(game.wrong).toBe(0)
  })

  it('counts a wrong note once, however it rattles', () => {
    const game = new FindNoteGame([target(45)], 1)
    game.ask(10)
    game.hear({ timeSec: 11, midi: [47] })
    game.hear({ timeSec: 11.08, midi: [47] })
    expect(game.wrong).toBe(1)
    expect(game.heardWrong).toBe(47)
    expect(game.hear({ timeSec: 12, midi: [45] })?.wrong).toBe(1)
    expect(game.streak).toBe(0)
  })

  it('does not take the last note sounding again for a wrong one', () => {
    const game = new FindNoteGame([target(45), target(47)], 1)
    game.ask(10)
    game.hear({ timeSec: 11, midi: [45] })
    game.ask(12)
    game.hear({ timeSec: 12.2, midi: [45] })
    expect(game.wrong).toBe(0)
    game.hear({ timeSec: 13, midi: [45] })
    expect(game.wrong).toBe(1)
  })

  it('wants the right octave', () => {
    const game = new FindNoteGame([target(69, 17)], 1)
    game.ask(10)
    expect(game.hear({ timeSec: 11, midi: [57] })).toBeNull()
    expect(game.wrong).toBe(1)
  })

  it('does not credit an octave the detector only offers as a second reading', () => {
    const game = new FindNoteGame([target(52)], 1)
    game.ask(10)
    expect(game.hear({ timeSec: 11, midi: [40, 52] })).toBeNull()
    expect(game.wrong).toBe(0)
    expect(game.hear({ timeSec: 12, midi: [52, 40] })?.found).toBe(true)
  })

  it('does not take a slide or hammer-on as the answer', () => {
    const game = new FindNoteGame([target(45)], 1)
    game.ask(10)
    expect(game.hear({ timeSec: 11, midi: [45], legato: true })).toBeNull()
    expect(game.wrong).toBe(0)
  })

  it('runs out of time, scores nothing and ends the streak', () => {
    const game = new FindNoteGame([target(45), target(47), target(48)], 1)
    game.ask(0)
    game.hear({ timeSec: 1, midi: [45] })
    expect(game.streak).toBe(1)
    game.ask(2)
    expect(game.expire(2 + NOTE_LIMIT_SEC)).toBeNull()
    const result = game.expire(2.3 + NOTE_LIMIT_SEC)
    expect(result).toMatchObject({ found: false, points: 0 })
    expect(game.streak).toBe(0)
  })

  it('asks nothing between rounds', () => {
    const game = new FindNoteGame([target(45), target(47)], 1)
    game.ask(0)
    game.hear({ timeSec: 1, midi: [45] })
    expect(game.hear({ timeSec: 1.3, midi: [47] })).toBeNull()
    expect(game.expire(100)).toBeNull()
  })
})

describe('find the note: what is remembered', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    })
  })

  it('keeps settings and best scores', () => {
    const settings = { ...DEFAULT_SETTINGS, notes: 'all' as const, rounds: 20 }
    saveFindNote({ settings, best: { [bestKey(settings)]: 900 } })
    expect(loadFindNote()).toEqual({ settings, best: { 'all-twelve-20': 900 } })
  })

  it('keeps the higher score of two tabs', () => {
    expect(mergeBest({ a: 5, b: 9 }, { a: 7, c: 1 })).toEqual({ a: 7, b: 9, c: 1 })
  })

  it('survives damaged storage', () => {
    localStorage.setItem('riffmaster.findNote', '{bad')
    expect(loadFindNote().settings).toEqual(DEFAULT_SETTINGS)
    localStorage.setItem('riffmaster.findNote', JSON.stringify({ settings: { neck: 'x', rounds: 7 }, best: { a: 'y', b: 5 } }))
    expect(loadFindNote()).toEqual({ settings: DEFAULT_SETTINGS, best: { b: 5 } })
  })
})
