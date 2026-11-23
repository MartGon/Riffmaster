import { describe, expect, it } from 'vitest'
import { leadInStart } from './seek'

const lookup = { masterBars: [{ start: 0, end: 960 }, { start: 960, end: 4800 }, { start: 4800, end: 8640 }] }

describe('the bar before a selection', () => {
  it('is the bar played just before, whatever its length', () => {
    expect(leadInStart(lookup, 4800)).toBe(960)
    expect(leadInStart(lookup, 960)).toBe(0)
  })

  it('goes by the bar a selection starting mid-bar is in', () => {
    expect(leadInStart(lookup, 5000)).toBe(960)
  })

  it('does not exist at the start or past the end of the song', () => {
    expect(leadInStart(lookup, 0)).toBeNull()
    expect(leadInStart(lookup, 8640)).toBeNull()
  })
})
