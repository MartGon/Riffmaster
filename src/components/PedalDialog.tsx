import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import {
  assignPedalKey,
  canAssign,
  DEFAULT_PEDAL_KEYS,
  keyLabel,
  type PedalAction,
  type PedalKeys,
} from '../lib/pedal'

const ROWS: { action: PedalAction; title: string; about: string }[] = [
  { action: 'play', title: 'Play / stop', about: 'With Practice open, starts and stops a take. In wait mode, skips the note.' },
  { action: 'restart', title: 'Back to the start', about: 'Of the selected bars, or of the song.' },
  { action: 'next', title: 'Next section', about: 'With bars selected, selects the next section instead.' },
]

interface Props {
  keys: PedalKeys
  onChange: (keys: PedalKeys) => void
  onClose: () => void
}

/** Chooses which key of a foot pedal does what. */
export function PedalDialog({ keys, onChange, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  /** The action waiting for its key to be pressed. */
  const [listening, setListening] = useState<PedalAction | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  const onKeyDown = (event: KeyboardEvent) => {
    // Escape held down after giving up on a key must not close the dialog too.
    if (event.code === 'Escape' && event.repeat) {
      event.preventDefault()
      return
    }
    if (!listening) return
    // Escape gives up; every other key is the answer, and must not also scroll or press a button.
    if (event.code === 'Escape') {
      event.preventDefault()
      setListening(null)
      setProblem(null)
      return
    }
    if (/^(Shift|Control|Alt|Meta|OS)/.test(event.code)) return
    // Held, a key must not press the focused button either.
    event.preventDefault()
    if (event.repeat) return
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      setProblem('Use a single key, without Shift, Ctrl, Alt or Cmd.')
      return
    }
    if (!canAssign(event.code)) {
      setProblem(`${keyLabel(event.code)} is needed by the app. Choose another key.`)
      return
    }
    onChange(assignPedalKey(keys, listening, event.code))
    setListening(null)
    setProblem(null)
  }

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby={`${id}-title`}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault()
        if (listening) setListening(null)
        else onClose()
      }}
    >
      <h2 id={`${id}-title`}>Foot pedal</h2>
      <p className="dialog-intro">
        A Bluetooth page-turner acts as a keyboard. Connect it to this device, then press Change and tap the pedal.
      </p>
      <div className="pedal-rows">
        {ROWS.map(({ action, title, about }) => (
          <div className="pedal-row" key={action}>
            <span>
              <strong>{title}</strong>
              <span className="drill-about">{about}</span>
            </span>
            <span className="pedal-key" role={listening === action ? 'status' : undefined}>
              {listening === action ? 'Press the pedal…' : keyLabel(keys[action])}
            </span>
            <button
              type="button"
              className="toggle"
              aria-label={`Change the key for ${title}`}
              onClick={() => {
                setProblem(null)
                setListening(listening === action ? null : action)
              }}
            >
              {listening === action ? 'Cancel' : 'Change'}
            </button>
            <button
              type="button"
              className="toggle"
              aria-label={`No key for ${title}`}
              disabled={keys[action] === null}
              onClick={() => {
                setListening(null)
                setProblem(null)
                onChange(assignPedalKey(keys, action, null))
              }}
            >
              Clear
            </button>
          </div>
        ))}
      </div>
      {problem && (
        <p className="dialog-error" role="alert">
          {problem}
        </p>
      )}
      <div className="dialog-buttons">
        <button
          type="button"
          className="button"
          onClick={() => {
            setListening(null)
            setProblem(null)
            onChange({ ...DEFAULT_PEDAL_KEYS })
          }}
        >
          Reset
        </button>
        <button type="button" className="button primary" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  )
}
