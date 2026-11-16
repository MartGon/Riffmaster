import { describe, expect, it } from 'vitest'
import { fretSpan, neckDots } from './layout'

const note = (string: number, fret: number, realValue = 60, isDead = false) => ({
  id: 7,
  string,
  fret,
  realValue,
  isDead,
})

describe('neckDots', () => {
  it('puts the lowest string at the bottom', () => {
    expect(neckDots([note(1, 3, 43), note(6, 0, 64)], 6, 0)).toEqual([
      { row: 5, fret: 3, midi: 43, dead: false, id: 7 },
      { row: 0, fret: 0, midi: 64, dead: false, id: 7 },
    ])
  })

  it('counts frets from the capo', () => {
    expect(neckDots([note(2, 2), note(3, 0)], 6, 2).map((dot) => dot.fret)).toEqual([4, 2])
  })

  it('works for a four-string bass and drops notes on strings that do not exist', () => {
    expect(neckDots([note(4, 5), note(5, 1)], 4, 0)).toEqual([{ row: 0, fret: 5, midi: 60, dead: false, id: 7 }])
  })
})

describe('fretSpan', () => {
  it('shows at least twelve frets and at most twenty-four', () => {
    expect(fretSpan(5)).toBe(12)
    expect(fretSpan(14)).toBe(15)
    expect(fretSpan(30)).toBe(24)
  })
})
