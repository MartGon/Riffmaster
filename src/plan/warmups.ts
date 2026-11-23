import { EXERCISES, exerciseFileName, initialValues } from '../exercises/catalogue'
import type { WarmUp } from './plan'

/** Finger exercises a plan rotates through, one a day. */
const WARM_UP_IDS = ['spider', 'spider-pairs', 'string-skipping', 'legato', 'shifts']

export const WARMUPS: WarmUp[] = EXERCISES.filter((exercise) => WARM_UP_IDS.includes(exercise.id)).map((exercise) => ({
  id: exercise.id,
  name: exercise.name,
  fileName: exerciseFileName(exercise, initialValues(exercise)),
}))
