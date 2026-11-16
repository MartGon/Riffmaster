import { useEffect, useId, useRef } from 'react'
import type { Mark } from '../practice/grades'
import { TIMING_LEEWAYS } from '../practice/matching'
import { DELAY_SOURCE_TEXT, type TakeDetails } from '../practice/takeReport'
import { Shape } from './GradeShape'

interface Props {
  details: TakeDetails
  /** Saves the take's recording for troubleshooting. */
  onSave: () => void
  onClose: () => void
}

const gradeText: Record<Mark, string> = {
  onTime: 'On time',
  early: 'Early',
  late: 'Late',
  missed: 'Missed',
}

const percent = (share: number) => `${Math.round(share * 100)}%`
/** Decibels with a real minus sign, or "silent". */
const db = (value: number | null) => (value === null ? 'silent' : `${value.toFixed(1).replace('-', '−')} dB`)

/** Note by note, what the app heard in the last take against what the tab expected. */
export function TakeReportDialog({ details, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  const { summary, rows, looping } = details
  const leeway = TIMING_LEEWAYS.find((item) => item.id === details.leeway)?.label ?? details.leeway
  const source = details.latencySource ? (DELAY_SOURCE_TEXT[details.latencySource] ?? details.latencySource) : null

  return (
    <dialog
      ref={dialog}
      className="dialog take-report"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <h2 id={`${id}-title`}>Take report</h2>
      <div className="take-report-lines">
        <p>
          <strong>{percent(summary.accuracy)}</strong> · {summary.hit} of {summary.scored} notes: {summary.onTime} on
          time, {summary.early} early, {summary.late} late, {summary.missed} missed
          {summary.extraNotes > 0 && (
            <>
              ; {summary.extraNotes} other {summary.extraNotes === 1 ? 'note' : 'notes'} heard
            </>
          )}
          .
        </p>
        <p>
          Input: {details.inputLabel ?? 'unknown'}: peak {db(details.peakDb)}, average {db(details.rmsDb)}. Delay
          used: {Math.round(details.latencyMs)} ms{source && <> ({source})</>}. Timing: {leeway}.
        </p>
        {details.warning && (
          <p className="take-report-warning" role="alert">
            {details.warning === 'clipping'
              ? 'The input is clipping: turn the gain down.'
              : 'The input is very quiet: turn the gain up or move the microphone closer.'}
          </p>
        )}
        {details.chords > 0 && (
          <p>
            {details.chords} {details.chords === 1 ? 'chord was' : 'chords were'} not scored.
          </p>
        )}
      </div>
      <div className="take-report-table" tabIndex={0} role="region" aria-label="Notes of the take">
        <table aria-label="Notes of the take: what the tab expected and what was heard">
          <thead>
            <tr>
              <th scope="col">#</th>
              {looping && <th scope="col">Pass</th>}
              <th scope="col">Bar</th>
              <th scope="col">Note</th>
              <th scope="col">Where</th>
              <th scope="col">Result</th>
              <th scope="col">Timing</th>
              <th scope="col">Heard instead</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.number} className={row.grade === 'missed' ? 'missed' : undefined}>
                <td className="number">{row.number}</td>
                {looping && <td className="number">{row.pass}</td>}
                <td className="number">{row.bar}</td>
                <td>{row.written}</td>
                <td>{row.place}</td>
                <td>
                  <span className="take-report-grade">
                    <Shape mark={row.grade} />
                    {gradeText[row.grade]}
                  </span>
                </td>
                <td>{row.timing}</td>
                <td>{row.heardInstead}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {summary.missed > 0 && details.byString.length > 0 && (
        <p className="take-report-strings">
          Missed per string:{' '}
          {details.byString.map((item) => `${item.label}: ${item.missed} of ${item.total}`).join(', ')}
        </p>
      )}
      <div className="dialog-buttons">
        <button
          type="button"
          className="button"
          onClick={onSave}
          title="Downloads the recording of this take with what the app heard, to find out why notes were missed"
        >
          Save take
        </button>
        <button type="button" className="button primary" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  )
}
