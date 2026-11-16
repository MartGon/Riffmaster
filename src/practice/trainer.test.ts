import { describe, expect, it } from 'vitest'
import { trainerOutcome } from './trainer'

const settings = { threshold: 0.9, step: 0.05 }

describe('trainerOutcome', () => {
  it('raises the speed after a passed round', () => {
    expect(trainerOutcome(0.6, 0.95, settings)).toEqual({ passed: true, nextSpeed: 0.65, finished: false })
  })

  it('passes a round that lands exactly on the threshold', () => {
    expect(trainerOutcome(0.6, 0.9, settings).passed).toBe(true)
    expect(trainerOutcome(0.6, 9 / 10, { threshold: 0.9, step: 0.1 }).nextSpeed).toBeCloseTo(0.7)
  })

  it('repeats the same speed after a failed round', () => {
    expect(trainerOutcome(0.6, 0.85, settings)).toEqual({ passed: false, nextSpeed: 0.6, finished: false })
  })

  it('does not go past the written tempo', () => {
    expect(trainerOutcome(0.95, 1, { threshold: 0.9, step: 0.1 })).toEqual({
      passed: true,
      nextSpeed: 1,
      finished: false,
    })
  })

  it('finishes once the written tempo is passed', () => {
    expect(trainerOutcome(1, 0.92, settings).finished).toBe(true)
    expect(trainerOutcome(1, 0.5, settings).finished).toBe(false)
    expect(trainerOutcome(1.2, 0.95, settings)).toEqual({ passed: true, nextSpeed: 1.2, finished: true })
  })
})
