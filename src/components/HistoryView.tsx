import type { TakeRecord } from '../library/types'
import { summarizeHistory, troubleBars } from '../practice/history'

interface Props {
  /** Takes of the shown track, oldest first. */
  takes: TakeRecord[]
  disabled: boolean
  onLoopBar: (bar: number) => void
  onClear: () => void
}

const percent = (share: number) => `${Math.round(share * 100)}%`

function when(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

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
export function HistoryView({ takes, disabled, onLoopBar, onClear }: Props) {
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
      </div>
      <table className="history-table">
        <caption>Latest takes</caption>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Tempo</th>
            <th scope="col">Bars</th>
            <th scope="col">Played</th>
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
        <button type="button" className="toggle" disabled={disabled} onClick={onClear}>
          Clear history
        </button>
      </div>
    </div>
  )
}
