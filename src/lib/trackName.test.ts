import { describe, expect, it } from 'vitest'
import { splitTrackName } from './trackName'

describe('splitTrackName', () => {
  it('keeps a plain name as the label', () => {
    expect(splitTrackName('Rhythm Guitar')).toEqual({ label: 'Rhythm Guitar', context: '' })
  })

  it('uses the last segment as the label and the rest as context', () => {
    expect(
      splitTrackName('John Frusciante | Gretsch White Falcon | Rhythm Guitar - Electric Guitar (clean)'),
    ).toEqual({
      label: 'Rhythm Guitar - Electric Guitar (clean)',
      context: 'John Frusciante · Gretsch White Falcon',
    })
  })

  it('ignores empty segments and repeated spaces', () => {
    expect(splitTrackName('Flea |  | Bass  - Electric Bass')).toEqual({
      label: 'Bass - Electric Bass',
      context: 'Flea',
    })
  })
})
