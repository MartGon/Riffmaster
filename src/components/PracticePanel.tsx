import { useState } from 'react'
import type { TakeRecord } from '../library/types'
import { gradeShapes, type Mark } from '../practice/grades'
import { TIMING_LEEWAYS, type TimingLeeway } from '../practice/matching'
import { TRAINER_STEPS, TRAINER_THRESHOLDS } from '../practice/trainer'
import type { PracticeActions, PracticeResult, PracticeState } from '../practice/usePractice'
import { HistoryView } from './HistoryView'
import { Icon } from './Icon'

const sourceText: Record<PracticeResult['latencySource'], string> = {
  measured: 'measured for this input',
  estimated: 'worked out from your playing',
  remembered: 'remembered from your last take',
  none: 'not enough notes to work out the delay',
}

const percent = (share: number) => `${Math.round(share * 100)}%`

/** The shape that marks a result in the tab, as a key beside its count. */
function Shape({ mark }: { mark: Mark }) {
  return (
    <svg
      className={`mark-key mark-${mark}`}
      viewBox="0 0 10 10"
      width="11"
      height="11"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: gradeShapes[mark] }}
    />
  )
}

function Results({ result, onClear }: { result: PracticeResult; onClear: () => void }) {
  const { summary } = result
  return (
    <div className="practice-results" role="status">
      <div className="practice-score">
        <strong>{percent(summary.accuracy)}</strong>
        <span>
          {summary.hit} of {summary.scored} notes
        </span>
      </div>
      <ul className="practice-breakdown">
        <li>
          <Shape mark="onTime" />
          {summary.onTime} on time
        </li>
        <li>
          <Shape mark="early" />
          {summary.early} early
        </li>
        <li>
          <Shape mark="late" />
          {summary.late} late
        </li>
        <li>
          <Shape mark="missed" />
          {summary.missed} missed
        </li>
      </ul>
      <p className="practice-detail">
        {summary.typicalOffsetMs !== null && (
          <>Typically {Math.round(summary.typicalOffsetMs)} ms from the beat. </>
        )}
        {result.latencySource === 'measured' &&
          summary.biasMs !== null &&
          Math.abs(summary.biasMs) >= 15 && (
            <>
              Overall you played about {Math.abs(Math.round(summary.biasMs))} ms{' '}
              {summary.biasMs > 0 ? 'behind' : 'ahead of'} the beat.{' '}
            </>
          )}
        Delay used: {result.latencyMs} ms ({sourceText[result.latencySource]}).
        {summary.unscored > 0 && <> {summary.unscored} chords were not scored.</>}
      </p>
      <button type="button" className="toggle" onClick={onClear}>
        <Icon name="close" />
        Clear results
      </button>
    </div>
  )
}

interface Props {
  state: PracticeState
  actions: PracticeActions
  /** Playback speed factor, to tell whether the trainer has anywhere to go. */
  speed: number
  /** Practice takes of the shown track, oldest first. */
  takes: TakeRecord[]
  onLoopBar: (bar: number) => void
  onClearHistory: () => void
}

export function PracticePanel({ state, actions, speed, takes, onLoopBar, onClearHistory }: Props) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const recording = state.phase === 'recording' || state.phase === 'starting'
  const measuring = recording && state.kind === 'measure'
  const { trainer } = state
  const practising = (recording && state.kind === 'practice') || trainer.running
  const busy = recording || trainer.running

  return (
    <section className="practice" aria-label="Practice">
      {state.error && (
        <p className="practice-message error-text" role="alert">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p className="practice-message" role="status">
          {state.notice}
        </p>
      )}

      <div className="practice-row">
        <label className="field">
          <span>Input</span>
          <select
            value={state.inputId ?? ''}
            disabled={busy || state.inputs.length === 0}
            onChange={(event) => actions.selectInput(event.target.value)}
          >
            {state.inputs.length === 0 && <option value="">No input</option>}
            {state.inputs.map((input) => (
              <option key={input.id} value={input.id}>
                {input.label}
              </option>
            ))}
          </select>
        </label>
        <div
          className="meter"
          role="meter"
          aria-label="Input level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(1, state.level) * 100)}
        >
          <div style={{ width: `${Math.min(100, Math.sqrt(state.level) * 100)}%` }} />
        </div>

        <label className="field">
          <span>Delay</span>
          <select
            value={state.mode}
            disabled={busy}
            onChange={(event) => actions.setMode(event.target.value === 'measured' ? 'measured' : 'auto')}
          >
            <option value="auto">Automatic, from your playing</option>
            <option value="measured" disabled={state.measuredMs === null}>
              {state.measuredMs === null ? 'Measured (not measured yet)' : `Measured, ${state.measuredMs} ms`}
            </option>
          </select>
        </label>
        <button
          type="button"
          className="toggle"
          disabled={!state.micReady || practising}
          title="Hold a headphone against the microphone and let the app time its own sound"
          onClick={measuring ? actions.stop : actions.measure}
        >
          {measuring ? 'Stop measuring' : 'Measure delay'}
        </button>

        <span className="practice-spacer" />
        {recording && state.kind === 'practice' && state.live && (
          <span className="practice-live" role="status">
            {state.live.hit} / {state.live.total} notes
          </span>
        )}
        <button
          type="button"
          className="button primary"
          disabled={!state.micReady || measuring}
          onClick={practising ? actions.stop : actions.start}
        >
          <Icon name={practising ? 'stop' : 'mic'} />
          {practising ? (trainer.running ? 'Stop trainer' : 'Stop') : 'Start practice'}
        </button>
      </div>

      <div className="practice-row practice-options">
        <label className="check">
          <input
            type="checkbox"
            checked={state.liveMarks}
            onChange={(event) => actions.setLiveMarks(event.target.checked)}
          />
          Mark notes while playing
        </label>
        <label className="field inline">
          <span>Timing</span>
          <select
            value={state.leeway}
            disabled={busy}
            title="How far from the beat a note may be and still count as on time"
            onChange={(event) => actions.setLeeway(event.target.value as TimingLeeway)}
          >
            {TIMING_LEEWAYS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={trainer.enabled}
            disabled={busy}
            onChange={(event) => actions.setTrainer({ enabled: event.target.checked })}
          />
          Speed trainer
        </label>
        {trainer.enabled && (
          <>
            <label className="field inline">
              <span>Move up at</span>
              <select
                value={trainer.threshold}
                disabled={busy}
                onChange={(event) => actions.setTrainer({ threshold: Number(event.target.value) })}
              >
                {TRAINER_THRESHOLDS.map((value) => (
                  <option key={value} value={value}>
                    {percent(value)} played
                  </option>
                ))}
              </select>
            </label>
            <label className="field inline">
              <span>Raise tempo by</span>
              <select
                value={trainer.step}
                disabled={busy}
                onChange={(event) => actions.setTrainer({ step: Number(event.target.value) })}
              >
                {TRAINER_STEPS.map((value) => (
                  <option key={value} value={value}>
                    {percent(value)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <span className="practice-spacer" />
        <button
          type="button"
          className="toggle"
          aria-pressed={historyOpen}
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((open) => !open)}
        >
          <Icon name="history" />
          History{takes.length > 0 ? ` (${takes.length})` : ''}
        </button>
      </div>

      {trainer.enabled && !trainer.running && !trainer.status && (
        <p className="practice-message">
          {speed >= 1
            ? 'The trainer raises the tempo up to the written one. Lower the tempo first, and select the bars to repeat.'
            : `The trainer repeats the selected bars from ${percent(speed)} tempo and moves up each time you play ${percent(trainer.threshold)} of the notes.`}
        </p>
      )}
      {trainer.status && (
        <p className="practice-message trainer-status" role="status">
          {trainer.status}
        </p>
      )}
      {practising && state.pass > 0 && (
        <p className="practice-message" role="status">
          Looping: pass {state.pass}
          {state.passes.length > 0 && <>. Finished passes: {state.passes.map(percent).join(', ')}</>}
        </p>
      )}
      {!practising && state.phase === 'results' && state.passes.length > 1 && (
        <p className="practice-message">
          {state.passes.length} passes: {state.passes.map(percent).join(', ')}. The result below is
          the last one.
        </p>
      )}
      {measuring && (
        <p className="practice-message" role="status">
          Measuring: hold one headphone right against the microphone. The track plays on its own for
          a few bars; press Stop measuring when it has.
        </p>
      )}
      {state.phase === 'results' && state.result && (
        <Results result={state.result} onClear={actions.dismissResult} />
      )}
      {historyOpen && (
        <HistoryView takes={takes} disabled={busy} onLoopBar={onLoopBar} onClear={onClearHistory} />
      )}
    </section>
  )
}
