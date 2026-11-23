import { PLAN_MINUTES, type PlanStep, STEP_LABEL, stepDetail } from '../plan/plan'
import { Icon } from './Icon'

interface Props {
  steps: PlanStep[]
  done: Set<string>
  skipped: Set<string>
  minutes: number
  disabled: boolean
  onMinutes: (minutes: number) => void
  onStart: (step: PlanStep) => void
}

/** Today's practice plan, at the top of the library. */
export function PlanCard({ steps, done, skipped, minutes, disabled, onMinutes, onStart }: Props) {
  const next = steps.find((step) => !done.has(step.id) && !skipped.has(step.id))
  const finished = steps.filter((step) => done.has(step.id)).length
  return (
    <section className="plan" aria-label="Today's practice">
      <div className="plan-head">
        <h2>Today&apos;s practice</h2>
        <span className="plan-progress">
          {finished} of {steps.length} done
        </span>
        <label className="plan-minutes">
          <span>Time</span>
          <select value={minutes} onChange={(event) => onMinutes(Number(event.target.value))}>
            {PLAN_MINUTES.map((value) => (
              <option key={value} value={value}>
                {value} min
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button primary"
          disabled={disabled || !next}
          onClick={() => next && onStart(next)}
        >
          <Icon name="play" />
          {finished > 0 ? 'Continue' : 'Start'}
        </button>
      </div>
      {!next && finished === steps.length && (
        <p className="plan-finished">That is today&apos;s plan done. Tomorrow&apos;s picks up from how it went.</p>
      )}
      {!next && finished < steps.length && <p className="plan-reason">The rest is skipped for today. Pick a step to do it anyway.</p>}
      <ol className="plan-steps">
        {steps.map((step) => {
          const isDone = done.has(step.id)
          const isSkipped = !isDone && skipped.has(step.id)
          return (
            <li key={step.id} className={isDone ? 'plan-step done' : isSkipped ? 'plan-step skipped' : 'plan-step'}>
              <button type="button" disabled={disabled} onClick={() => onStart(step)}>
                <span className={`plan-kind ${step.kind}`}>{STEP_LABEL[step.kind]}</span>
                <span className="plan-text">
                  <span className="plan-title">
                    {step.title}
                    {stepDetail(step) && <span className="plan-detail"> · {stepDetail(step)}</span>}
                  </span>
                  <span className="plan-reason">{isDone ? 'Done today.' : isSkipped ? 'Skipped today.' : step.reason}</span>
                </span>
                <span className="plan-time">{step.minutes} min</span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
