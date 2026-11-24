import { useId } from 'react'
import { type GuitarSetup, MAX_CAPO, MAX_STRING_SHIFT } from '../player/guitarSetup'
import type { TrackInfo } from '../player/usePlayer'
import { pitchClassName } from '../tuner/tuning'

interface Props {
  track: TrackInfo
  /** Semitones the whole guitar is shifted by, for naming its strings. */
  pitch: number
  setup: GuitarSetup | undefined
  onChange: (setup: GuitarSetup | null) => void
  disabled?: boolean
}

const signed = (value: number) => (value > 0 ? `+${value}` : `−${-value}`)
const SHIFTS = Array.from({ length: MAX_STRING_SHIFT * 2 + 1 }, (_, i) => i - MAX_STRING_SHIFT)

/**
 * The player's capo and strings tuned on their own. The tab is re-fretted for
 * that guitar; the song sounds, and is scored, as written.
 */
export function GuitarSetupPicker({ track, pitch, setup, onChange, disabled = false }: Props) {
  const id = useId()
  const strings = track.writtenTuning
  const shifts = setup?.strings ?? strings.map(() => 0)
  const change = (next: GuitarSetup) => {
    const clean: GuitarSetup = {}
    if (next.capo !== undefined) clean.capo = next.capo
    if (next.strings?.some((value) => value !== 0)) clean.strings = next.strings
    onChange(clean.capo === undefined && clean.strings === undefined ? null : clean)
  }
  const retuned = shifts.some((value) => value !== 0)

  return (
    <div className="guitar-setup">
      <label className="tuning-picker" title="Where your capo is. The tab shows frets from it; the song sounds the same.">
        <span>Capo</span>
        <select
          value={setup?.capo ?? ''}
          disabled={disabled}
          onChange={(event) => change({ ...setup, capo: event.target.value === '' ? undefined : Number(event.target.value) })}
        >
          <option value="">{track.writtenCapo > 0 ? `Fret ${track.writtenCapo} (as written)` : 'None (as written)'}</option>
          {Array.from({ length: MAX_CAPO + 1 }, (_, fret) => fret)
            .filter((fret) => fret !== track.writtenCapo)
            .map((fret) => (
              <option key={fret} value={fret}>
                {fret === 0 ? 'None' : `Fret ${fret}`}
              </option>
            ))}
        </select>
      </label>
      <details className="string-tuning" open={retuned || undefined}>
        <summary>{retuned ? 'Strings retuned' : 'Retune single strings'}</summary>
        <div className="string-rows" role="group" aria-labelledby={`${id}-strings`}>
          <span id={`${id}-strings`} className="visually-hidden">
            Single strings
          </span>
          {strings.map((midi, index) => (
            <label key={index} className="string-row">
              <span>String {index + 1}</span>
              <select
                value={shifts[index]}
                disabled={disabled}
                onChange={(event) => {
                  const next = [...shifts]
                  next[index] = Number(event.target.value)
                  change({ ...setup, strings: next })
                }}
              >
                {SHIFTS.map((shift) => (
                  <option key={shift} value={shift}>
                    {pitchClassName(midi + pitch + shift)}
                    {shift === 0 ? ' (as tuned)' : ` (${signed(shift)})`}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {retuned && (
            <button type="button" className="toggle" disabled={disabled} onClick={() => change({ ...setup, strings: undefined })}>
              Put strings back
            </button>
          )}
        </div>
      </details>
      {(track.moved > 0 || track.unplayable > 0) && (
        <p className="setup-note">
          {track.moved > 0 && `${track.moved} ${track.moved === 1 ? 'note is' : 'notes are'} moved to another string. `}
          {track.unplayable > 0 &&
            `${track.unplayable} ${track.unplayable === 1 ? 'note' : 'notes'} cannot be played with this setup.`}
        </p>
      )}
    </div>
  )
}
