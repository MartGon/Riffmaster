import { useEffect, useId, useRef } from 'react'
import {
  bestKey,
  difficultyFactor,
  GAME_TUNINGS,
  NECK_CHOICES,
  type NeckChoice,
  NOTE_CHOICES,
  type NoteChoice,
  noteLabel,
  ROUND_CHOICES,
  stringLabel,
  zoneLabel,
} from '../exercises/findNote'
import { useFindNote } from '../exercises/useFindNote'
import { useWakeLock } from '../lib/wakeLock'
import { noteName } from '../tuner/tuning'

interface Props {
  onClose: () => void
}

const seconds = (value: number) => `${value.toFixed(2)} s`

/** A game: shown a string and a note, play it as fast as you can. */
export function FindNoteDialog({ onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const { view, settings, best, changeSettings, start, stop } = useFindNote()

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  const open = (GAME_TUNINGS.find((item) => item.id === settings.tuning) ?? GAME_TUNINGS[0]).open
  const bestScore = best[bestKey(settings)]
  const inGame = view.phase === 'opening' || view.phase === 'count' || view.phase === 'asking' || view.phase === 'answered'
  const summary = view.summary
  // Both hands are on the guitar, so nothing else keeps a phone's screen awake.
  useWakeLock(inGame)

  // The button pressed goes away with its part of the dialog, so focus moves to what replaces it.
  const part = inGame ? 'game' : view.phase === 'done' ? 'done' : 'setup'
  const partRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (part !== 'setup') partRef.current?.focus()
  }, [part])

  // Said to a screen reader: the visible prompt is split over several lines, and changes often.
  const announcement =
    view.phase === 'count'
      ? String(view.count)
      : (view.phase === 'asking' || view.phase === 'answered') && view.target
        ? view.last
          ? view.last.found
            ? `Right, fret ${view.target.fret}. ${view.last.points} points.`
            : `Time's up. It was fret ${view.target.fret}.`
          : view.heardWrong !== null
            ? `Heard ${noteName(view.heardWrong)}. Try again.`
            : `${stringLabel(open, view.target.string)}, ${noteLabel(view.target.midi)}, ${zoneLabel(view.target, settings.neck)}`
        : ''

  return (
    <dialog
      ref={dialog}
      className="dialog find-note"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <h2 id={`${id}-title`}>Find the note</h2>

      {view.phase === 'setup' && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void start()
          }}
        >
          <p className="dialog-intro">You get a string and a note. Play it as fast as you can. Speed, clean notes and streaks score points.</p>
          <div className="field-row exercise-options">
            <label className="field">
              <span>Notes</span>
              <select value={settings.notes} onChange={(event) => changeSettings({ notes: event.target.value as NoteChoice })}>
                {NOTE_CHOICES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Neck</span>
              <select value={settings.neck} onChange={(event) => changeSettings({ neck: event.target.value as NeckChoice })}>
                {NECK_CHOICES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Notes per game</span>
              <select value={settings.rounds} onChange={(event) => changeSettings({ rounds: Number(event.target.value) })}>
                {ROUND_CHOICES.map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Tuning</span>
              <select value={settings.tuning} onChange={(event) => changeSettings({ tuning: event.target.value })}>
                {GAME_TUNINGS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="find-note-meta">
            Difficulty ×{difficultyFactor(settings).toFixed(2)}
            {bestScore !== undefined && ` · Best ${bestScore.toLocaleString()}`}
          </p>
          {view.error && (
            <p className="dialog-error" role="alert">
              {view.error}
            </p>
          )}
          <div className="dialog-buttons">
            <button type="button" className="button" onClick={onClose}>
              Close
            </button>
            <button type="submit" className="button primary">
              Start
            </button>
          </div>
        </form>
      )}

      {inGame && (
        <div className="find-note-game" ref={partRef} tabIndex={-1}>
          <p className="visually-hidden" role="status">
            {announcement}
          </p>
          <div className="find-note-top">
            <span>
              Note {Math.min(view.index + 1, view.total)} of {view.total}
            </span>
            <span>{view.streak > 1 ? `Streak ${view.streak}` : ''}</span>
            <strong className="find-note-score">{view.score.toLocaleString()}</strong>
          </div>
          <div className="find-note-time" aria-hidden="true">
            <span style={{ transform: `scaleX(${view.phase === 'asking' ? view.left : 0})` }} />
          </div>
          {view.phase === 'opening' && <p className="find-note-wait">Opening the microphone…</p>}
          {view.phase === 'count' && <p className="find-note-count">{view.count}</p>}
          {(view.phase === 'asking' || view.phase === 'answered') && view.target && (
            <div className={`find-note-prompt ${view.last ? (view.last.found ? 'right' : 'missed') : ''}`}>
              <span className="find-note-string">{stringLabel(open, view.target.string)}</span>
              <strong className="find-note-name">{noteLabel(view.target.midi)}</strong>
              <span className="find-note-zone">{zoneLabel(view.target, settings.neck)}</span>
              <p className="find-note-status" aria-hidden="true">
                {view.last
                  ? view.last.found
                    ? `+${view.last.points} · ${seconds(view.last.seconds ?? 0)} · fret ${view.target.fret}`
                    : `Time's up. It was fret ${view.target.fret}.`
                  : view.heardWrong !== null
                    ? `Heard ${noteName(view.heardWrong)}. Try again.`
                    : ' '}
              </p>
            </div>
          )}
          <div className="dialog-buttons">
            <button type="button" className="button" onClick={() => stop()}>
              Stop
            </button>
          </div>
        </div>
      )}

      {view.phase === 'done' && summary && (
        <div className="find-note-results" ref={partRef} tabIndex={-1}>
          <div className="find-note-grade" aria-label={`Grade ${summary.grade}`}>
            {summary.grade}
          </div>
          <p className="find-note-final">
            <strong>{summary.score.toLocaleString()}</strong> points
            {summary.score > (view.previousBest ?? 0) ? (
              <span className="find-note-best"> New best</span>
            ) : (
              view.previousBest !== null && <span> · Best {view.previousBest.toLocaleString()}</span>
            )}
          </p>
          <dl className="find-note-stats">
            <div>
              <dt>Found</dt>
              <dd>
                {summary.found} of {summary.total}
              </dd>
            </div>
            <div>
              <dt>First try</dt>
              <dd>{Math.round(summary.accuracy * 100)}%</dd>
            </div>
            <div>
              <dt>Average</dt>
              <dd>{summary.averageSec === null ? 'None' : seconds(summary.averageSec)}</dd>
            </div>
          </dl>
          {summary.worst.length > 0 && (
            <div className="find-note-worst">
              <h3>Worth another look</h3>
              <ul>
                {/* A short range can ask for the same place twice in one game. */}
                {summary.worst.map((item, index) => (
                  <li key={index}>
                    {noteLabel(item.target.midi)} on the {stringLabel(open, item.target.string)}: fret {item.target.fret}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="dialog-buttons">
            <button type="button" className="button" onClick={() => stop()}>
              Change settings
            </button>
            <button type="button" className="button primary" onClick={() => void start()}>
              Play again
            </button>
          </div>
        </div>
      )}
    </dialog>
  )
}
