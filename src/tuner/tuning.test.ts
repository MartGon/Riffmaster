import { describe, expect, it } from 'vitest'
import { noteName, pitchClassName, readTuning } from './tuning'

const guitar = [64, 59, 55, 50, 45, 40]
const hz = (midi: number, cents = 0) => 440 * 2 ** ((midi + cents / 100 - 69) / 12)

describe('note names', () => {
  it('names pitches with their octave', () => {
    expect(noteName(40)).toBe('E2')
    expect(noteName(69)).toBe('A4')
    expect(noteName(60)).toBe('C4')
    expect(noteName(28)).toBe('E1')
    expect(pitchClassName(61)).toBe('C♯')
  })
})

describe('readTuning', () => {
  it('finds the string and how flat it is', () => {
    const reading = readTuning(hz(40, -18), guitar)
    expect(reading.string).toBe(5)
    expect(reading.targetMidi).toBe(40)
    expect(reading.cents).toBeCloseTo(-18, 5)
  })

  it('keeps tracking a string that is more than a semitone off', () => {
    // A string wound down by a tone and a half is still that string.
    const reading = readTuning(hz(45, -150), guitar)
    expect(reading.string).toBe(4)
    expect(reading.cents).toBeCloseTo(-150, 5)
  })

  it('picks the nearer of two strings', () => {
    expect(readTuning(hz(57), guitar).string).toBe(1)
    expect(readTuning(hz(56.4), guitar).string).toBe(2)
  })

  it('falls back to the nearest note when no string is close', () => {
    const reading = readTuning(hz(76, 12), guitar)
    expect(reading.string).toBeNull()
    expect(reading.targetMidi).toBe(76)
    expect(reading.cents).toBeCloseTo(12, 5)
  })

  it('works without a tuning', () => {
    expect(readTuning(440, [])).toEqual({ targetMidi: 69, string: null, cents: 0 })
  })
})
