import { tuningName } from '../tuner/tuning'

interface Props {
  /** Open strings of the track shown, highest first, as written in the tab; empty when it has none. */
  tuning: number[]
  /** Semitones the song is shifted by. */
  pitch: number
  onChange: (pitch: number) => void
  disabled?: boolean
}

/** Shifts offered, in semitones; one already chosen outside them is offered as well. */
const SHIFTS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6]

function signed(shift: number): string {
  return shift > 0 ? `+${shift}` : `−${-shift}`
}

/**
 * Picks the tuning the guitar is in. The song is played and practised that
 * many semitones higher or lower, so the frets in the tab stay the same: a
 * song in E♭ standard can be played on a guitar in E standard.
 */
export function TuningPicker({ tuning, pitch, onChange, disabled = false }: Props) {
  const shifts = SHIFTS.includes(pitch) ? SHIFTS : [...SHIFTS, pitch].sort((a, b) => a - b)
  const name = (shift: number) => (tuning.length > 0 ? tuningName(tuning.map((midi) => midi + shift)) : '')
  const label = (shift: number) => {
    if (shift === 0) return tuning.length > 0 ? `${name(0)} (as written)` : 'As written'
    const semitones = `${signed(shift)} semitone${Math.abs(shift) === 1 ? '' : 's'}`
    return tuning.length > 0 ? `${name(shift)} (${semitones})` : semitones
  }
  return (
    <label className="tuning-picker" title="The tuning your guitar is in. The song plays and is scored in it; the frets in the tab stay the same.">
      <span>Tuning</span>
      <select value={pitch} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))}>
        {shifts.map((shift) => (
          <option key={shift} value={shift}>
            {label(shift)}
          </option>
        ))}
      </select>
    </label>
  )
}
