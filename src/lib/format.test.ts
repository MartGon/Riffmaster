import { describe, expect, it } from 'vitest'
import { clampSpeed, effectiveTempo, formatTime } from './format'

describe('formatTime', () => {
  it('formats minutes and zero-padded seconds', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(9_999)).toBe('0:09')
    expect(formatTime(65_000)).toBe('1:05')
    expect(formatTime(600_000)).toBe('10:00')
  })

  it('treats negative and non-finite values as zero', () => {
    expect(formatTime(-500)).toBe('0:00')
    expect(formatTime(Number.NaN)).toBe('0:00')
  })
})

describe('clampSpeed', () => {
  it('keeps values inside the supported range', () => {
    expect(clampSpeed(0.1)).toBe(0.25)
    expect(clampSpeed(5)).toBe(2)
  })

  it('snaps to 5% steps without floating point noise', () => {
    expect(clampSpeed(0.7 + 0.05)).toBe(0.75)
    expect(clampSpeed(0.82)).toBe(0.8)
    expect(clampSpeed(1.13)).toBe(1.15)
  })

  it('falls back to normal speed for invalid input', () => {
    expect(clampSpeed(Number.NaN)).toBe(1)
  })
})

describe('effectiveTempo', () => {
  it('scales the base tempo by the speed factor', () => {
    expect(effectiveTempo(96, 1)).toBe(96)
    expect(effectiveTempo(96, 0.5)).toBe(48)
    expect(effectiveTempo(97, 0.75)).toBe(73)
  })
})
