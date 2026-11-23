import { useEffect, useState } from 'react'
import { formatTime } from '../lib/format'
import { type PlanStep, STEP_LABEL, stepDetail } from '../plan/plan'
import { Icon } from './Icon'

interface Props {
  step: PlanStep
  number: number
  total: number
  done: boolean
  /** Whether another step follows this one. */
  hasNext: boolean
  /** A take is running, which moving on would cut off. */
  locked: boolean
  onNext: () => void
  onEnd: () => void
}

/** The plan step being practised, with the time left for it. Give it a `key` per step so the clock restarts. */
export function PlanBar({ step, number, total, done, hasNext, locked, onNext, onEnd }: Props) {
  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(startedAt)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const left = step.minutes * 60_000 - (now - startedAt)
  const action = done ? (hasNext ? 'Next step' : 'Finish') : hasNext ? 'Skip' : 'Skip and finish'
  return (
    <div className={done ? 'plan-bar done' : 'plan-bar'} role="status">
      <span className="plan-bar-text">
        <strong>
          {number}/{total} {STEP_LABEL[step.kind]}
        </strong>{' '}
        {stepDetail(step) || step.title}
        {done && ' · done'}
      </span>
      <span className={left <= 0 ? 'plan-clock over' : 'plan-clock'}>{left > 0 ? formatTime(left + 999) : "Time's up"}</span>
      <button type="button" className="toggle" disabled={locked} onClick={onNext}>
        {action}
      </button>
      <button type="button" className="icon-button" aria-label="Leave the plan" title="Leave the plan" onClick={onEnd}>
        <Icon name="close" />
      </button>
    </div>
  )
}
