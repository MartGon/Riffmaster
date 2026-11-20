import { clampSpeed } from '../lib/format'

/** Settings of the speed trainer, which repeats a section and raises the tempo as it is mastered. */
export interface TrainerSettings {
  enabled: boolean
  /** Share of notes, from 0 to 1, that must be played to move up. */
  threshold: number
  /** How much the speed factor rises after a passed round. */
  step: number
}

export const defaultTrainerSettings: TrainerSettings = { enabled: false, threshold: 0.9, step: 0.05 }

export const TRAINER_THRESHOLDS = [0.8, 0.9, 0.95, 1]
export const TRAINER_STEPS = [0.05, 0.1]
/** The trainer stops raising the tempo at the written one. */
const TRAINER_GOAL = 1

export interface TrainerOutcome {
  /** Whether the round reached the accuracy needed to move up. */
  passed: boolean
  /** Speed factor for the next round. */
  nextSpeed: number
  /** True when the round was passed at the goal tempo, so there is nothing left to raise. */
  finished: boolean
}

/** Decides what follows a trainer round played at `speed` with the given accuracy. */
export function trainerOutcome(
  speed: number,
  accuracy: number,
  settings: Pick<TrainerSettings, 'threshold' | 'step'>,
): TrainerOutcome {
  // A hair of slack so that 0.9 is not failed by a rounding error.
  const passed = accuracy >= settings.threshold - 1e-9
  if (!passed) return { passed, nextSpeed: speed, finished: false }
  if (speed >= TRAINER_GOAL - 1e-9) return { passed, nextSpeed: speed, finished: true }
  return { passed, nextSpeed: Math.min(TRAINER_GOAL, clampSpeed(speed + settings.step)), finished: false }
}
