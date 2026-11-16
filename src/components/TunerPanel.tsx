import { IN_TUNE_CENTS, noteName, pitchClassName } from '../tuner/tuning'
import type { TunerState } from '../tuner/useTuner'

interface Props {
  state: TunerState
  /** Open-string pitches of the shown track, highest string first. */
  tuning: number[]
}

/** Furthest the needle travels to either side, in cents. */
const RANGE = 50

export function TunerPanel({ state, tuning }: Props) {
  const reading = state.reading
  const cents = reading ? Math.round(reading.cents) : 0
  const inTune = reading !== null && Math.abs(reading.cents) <= IN_TUNE_CENTS
  const needle = reading ? 50 + (Math.max(-RANGE, Math.min(RANGE, reading.cents)) / RANGE) * 50 : 50
  let advice = 'Play one open string.'
  if (state.error) advice = ''
  else if (!state.listening) advice = 'Opening the input…'
  else if (reading) {
    advice = inTune ? 'In tune' : reading.cents < 0 ? 'Too low: tune up' : 'Too high: tune down'
  }

  return (
    <section className="practice tuner" aria-label="Tuner">
      {state.error && (
        <p className="practice-message error-text" role="alert">
          {state.error}
        </p>
      )}
      <div className="tuner-row">
        <div className="tuner-note">
          <strong>{reading ? noteName(reading.targetMidi) : '–'}</strong>
          <span>{reading ? `${cents > 0 ? '+' : ''}${cents} cents` : ' '}</span>
        </div>
        <div className="tuner-gauge">
          <div
            className={inTune ? 'tuner-scale in-tune' : 'tuner-scale'}
            role="meter"
            aria-label="Distance from the note, in cents"
            aria-valuemin={-RANGE}
            aria-valuemax={RANGE}
            aria-valuenow={Math.max(-RANGE, Math.min(RANGE, cents))}
          >
            <i className="tuner-zone" />
            <i className="tuner-centre" />
            {reading && <i className="tuner-needle" style={{ left: `${needle}%` }} />}
          </div>
          <div className="tuner-ends">
            <span>low</span>
            <span className={inTune ? 'tuner-advice in-tune' : 'tuner-advice'} role="status">
              {advice}
            </span>
            <span>high</span>
          </div>
        </div>
        {tuning.length > 0 && (
          <ol className="tuner-strings" aria-label="Strings, lowest first">
            {tuning
              .map((midi, index) => ({ midi, index }))
              .reverse()
              .map(({ midi, index }) => (
                <li
                  key={index}
                  className={reading?.string === index ? 'active' : undefined}
                  aria-current={reading?.string === index}
                  title={noteName(midi)}
                >
                  {pitchClassName(midi)}
                </li>
              ))}
          </ol>
        )}
      </div>
    </section>
  )
}
