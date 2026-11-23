import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import type { DrillChoices, DrillOptions } from '../exercises/drill'

interface Props {
  /** "Bar 9" or "Bars 9–12". */
  label: string
  options: DrillOptions
  /** Makes and opens the drill; resolves to an error message, or nothing when it worked. */
  onCreate: (choices: DrillChoices) => Promise<string | void>
  onClose: () => void
}

/** Chooses what a drill made from a hard passage contains. */
export function DrillDialog({ label, options, onCreate, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [choices, setChoices] = useState<DrillChoices>({
    slow: true,
    chunks: true,
    rhythms: options.rhythms,
    strings: false,
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    let problem: string | void
    try {
      problem = await onCreate(choices)
    } catch {
      problem = 'The drill could not be written out.'
    }
    setBusy(false)
    if (problem) setError(problem)
    else onClose()
  }

  const row = (key: keyof DrillChoices, title: string, about: string, available = true) => (
    <label className={available ? 'check drill-choice' : 'check drill-choice unavailable'}>
      <input
        type="checkbox"
        name={key}
        checked={available && choices[key]}
        disabled={!available}
        onChange={(event) => setChoices((current) => ({ ...current, [key]: event.target.checked }))}
      />
      <span>
        <strong>{title}</strong>
        <span className="drill-about">{available ? about : 'Not possible for these notes.'}</span>
      </span>
    </label>
  )

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <h2 id={`${id}-title`}>Make a drill from {label.toLowerCase()}</h2>
        {options.problem ? (
          <p className="dialog-error" role="alert">
            {options.problem}
          </p>
        ) : (
          <>
            <p className="dialog-intro">
              A new exercise in your library, built from these bars in your tuning. It always ends at full tempo.
              {options.leftOutPickup && ' The pick-up bar is left out.'}
            </p>
            <div className="drill-choices">
              {row('slow', 'Slow', 'The passage twice at 60% tempo.')}
              {row('chunks', 'Chunks', 'Short pieces on their own, then each joined to the next.')}
              {row('rhythms', 'Rhythms', 'Even notes played long-short, then short-long, to even out your fingers.', options.rhythms)}
              {row('strings', 'Other strings', 'The same line moved one string up and down.', options.strings)}
            </div>
          </>
        )}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-buttons">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy || options.problem !== null}>
            Make drill
          </button>
        </div>
      </form>
    </dialog>
  )
}
