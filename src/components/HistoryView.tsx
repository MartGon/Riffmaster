import type { TakeRecord } from '../library/types'
import { takeTime } from '../lib/format'
import { Icon } from './Icon'
import { summarizeHistory, troubleBars } from '../practice/history'
import type { SongProgress } from '../practice/progress'
import type { ListenState } from '../practice/useListenBack'
import { timingAssessed, timingHabits } from '../practice/tendencies'

interface Props {
  /** Takes of the shown track, oldest first. */
  takes: TakeRecord[]
  /** How far along the track is, worked out from the same takes. */
  progress: SongProgress | null
  disabled: boolean
  /** Takes that can be listened to, and the one being listened to. */
  recorded: Set<string>
  listening: ListenState
  onListen: (take: TakeRecord) => void
  onLoopBar: (bar: number) => void
  onClear: () => void
}

const percent = (share: number) => `${Math.round(share * 100)}%`

const when = takeTime

const describe = (take: TakeRecord) =>
  `${when(take.at)}: ${percent(take.accuracy)} of ${take.scored} notes at ${percent(take.speed)} tempo`

/** Accuracy of the most recent takes as a line, oldest on the left. */
function Trend({ takes }: { takes: TakeRecord[] }) {
  const shown = takes.slice(-20)
  const width = 280
  const height = 84
  const left = 30
  const right = 34
  const top = 8
  const bottom = 8
  const x = (index: number) =>
    shown.length === 1 ? (left + width - right) / 2 : left + (index / (shown.length - 1)) * (width - left - right)
  const y = (accuracy: number) => top + (1 - accuracy) * (height - top - bottom)
  const last = shown[shown.length - 1]
  return (
    <svg
      className="trend"
      width={width}
      height={height}
      role="img"
      aria-label={`Accuracy of the last ${shown.length} takes; the most recent was ${percent(last.accuracy)}`}
    >
      {[0, 0.5, 1].map((level) => (
        <g key={level}>
          <line className="trend-grid" x1={left} x2={width - right} y1={y(level)} y2={y(level)} />
          <text className="trend-axis" x={left - 6} y={y(level) + 3.5} textAnchor="end">
            {percent(level)}
          </text>
        </g>
      ))}
      {shown.length > 1 && (
        <polyline
          className="trend-line"
          points={shown.map((take, index) => `${x(index)},${y(take.accuracy)}`).join(' ')}
        />
      )}
      {shown.map((take, index) => (
        <g key={take.id}>
          <circle className="trend-point" cx={x(index)} cy={y(take.accuracy)} r={4} />
          {/* A larger invisible target, so the detail is easy to hover. */}
          <circle cx={x(index)} cy={y(take.accuracy)} r={9} fill="transparent">
            <title>{describe(take)}</title>
          </circle>
        </g>
      ))}
      <text className="trend-value" x={x(shown.length - 1) + 8} y={y(last.accuracy) + 4}>
        {percent(last.accuracy)}
      </text>
    </svg>
  )
}

/** Practice history of one track: the trend, the latest takes and the bars that keep going wrong. */
export function HistoryView({ takes, progress, disabled, recorded, listening, onListen, onLoopBar, onClear }: Props) {
  if (takes.length === 0) {
    return (
      <div className="history">
        <p className="practice-message">
          No takes yet for this track. Each practice take of four notes or more is kept here.
        </p>
      </div>
    )
  }
  const summary = summarizeHistory(takes)
  const trouble = troubleBars(takes)
  const habits = timingHabits(takes)
  const recent = takes.slice(-5).reverse()
  return (
    <div className="history">
      <div className="history-chart">
        <Trend takes={takes} />
        <p className="practice-message">
          {summary.takes} {summary.takes === 1 ? 'take' : 'takes'}
          {summary.best && (
            <>
              {' '}
              · best {percent(summary.best.accuracy)} at {percent(summary.best.speed)} tempo
            </>
          )}
        </p>
        {progress && (
          <p className="practice-message history-mastery">
            <strong>{percent(progress.mastery)} learned.</strong> {progress.mastered} of {progress.total}{' '}
            {progress.total === 1 ? 'bar' : 'bars'} clean at full tempo
            {progress.learning > 0 && `, ${progress.learning} coming along`}
            {progress.total - progress.mastered - progress.learning > 0 &&
              `, ${progress.total - progress.mastered - progress.learning} not played yet`}
            .
          </p>
        )}
      </div>
      <table className="history-table">
        <caption>Latest takes</caption>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Tempo</th>
            <th scope="col">Bars</th>
            <th scope="col">Played</th>
            <th scope="col">
              <span className="visually-hidden">Listen</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {recent.map((take) => (
            <tr key={take.id}>
              <td>{when(take.at)}</td>
              <td>{percent(take.speed)}</td>
              <td>
                {take.startBar + 1}–{take.endBar + 1}
              </td>
              <td>
                {percent(take.accuracy)} of {take.scored}
              </td>
              <td>
                {recorded.has(take.id) && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Listen to the take of ${when(take.at)}`}
                    title="Listen back, with the tab"
                    disabled={disabled || listening.takeId === take.id}
                    onClick={() => onListen(take)}
                  >
                    <Icon name="play" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="history-side">
        <div>
          <span className="history-label">Bars to work on</span>
          {trouble.length === 0 ? (
            <p className="practice-message">No bar stands out in your last takes.</p>
          ) : (
            <div className="history-bars">
              {trouble.map((bar) => (
                <button
                  key={bar.bar}
                  type="button"
                  className="toggle"
                  disabled={disabled}
                  title={`${bar.missed} missed and ${bar.offTime} mistimed of ${bar.scored} notes in your last takes. Click to loop this bar.`}
                  onClick={() => onLoopBar(bar.bar)}
                >
                  Bar {bar.bar + 1}
                  <span className="history-share">{percent(bar.trouble)} off</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="timing-habits">
          <span className="history-label">Timing habits</span>
          {habits.length === 0 ? (
            <p className="practice-message">
              {timingAssessed(takes)
                ? 'Nothing stands out yet. It takes at least three separate goes to tell a habit from a slip.'
                : 'These takes cannot show timing habits: they need steady notes around the moves, and a delay the app can tell from your playing. Measuring the delay helps.'}
            </p>
          ) : (
            <ul>
              {habits.map((habit) => (
                <li key={habit.kind}>
                  <strong>{habit.text}</strong> {habit.tip}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" className="toggle" disabled={disabled} onClick={onClear}>
          Clear history
        </button>
      </div>
    </div>
  )
}
