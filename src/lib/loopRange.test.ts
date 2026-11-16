import { describe, expect, it } from 'vitest'
import { type BeatLike, snapSelectionToBars } from './loopRange'

/** Builds bars of beats, each beat one unit long, as a minimal stand-in for alphaTab's model. */
function makeBars(beatsPerBar: number[]): BeatLike[][] {
  let position = 0
  return beatsPerBar.map((count) => {
    const beats: BeatLike[] = []
    const bar = { voices: [{ beats }] }
    for (let i = 0; i < count; i++) {
      beats.push({ absolutePlaybackStart: position++, voice: { bar } })
    }
    return beats
  })
}

describe('snapSelectionToBars', () => {
  it('widens a selection inside one bar to that whole bar', () => {
    const [bar] = makeBars([4])
    const { start, end } = snapSelectionToBars(bar[1], bar[2])
    expect(start).toBe(bar[0])
    expect(end).toBe(bar[3])
  })

  it('spans from the first bar start to the last bar end', () => {
    const bars = makeBars([4, 3, 4])
    const { start, end } = snapSelectionToBars(bars[0][2], bars[2][1])
    expect(start).toBe(bars[0][0])
    expect(end).toBe(bars[2][3])
  })

  it('accepts the beats in reverse order', () => {
    const bars = makeBars([4, 4])
    const { start, end } = snapSelectionToBars(bars[1][0], bars[0][3])
    expect(start).toBe(bars[0][0])
    expect(end).toBe(bars[1][3])
  })
})
