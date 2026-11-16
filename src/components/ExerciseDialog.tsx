import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { type BuiltExercise, buildExercise, EXERCISES, initialValues } from '../exercises/catalogue'

interface Props {
  /** Opens the written-out exercise; resolves to an error message, or nothing when it worked. */
  onOpen: (exercise: BuiltExercise) => Promise<string | void>
  onClose: () => void
}

type Chosen = Record<string, Record<string, string>>

/** What was chosen last time, so the dialog comes back where it was left during this visit. */
let remembered: { id: string; values: Chosen } = { id: EXERCISES[0].id, values: {} }
function remember(id: string, values: Chosen): void {
  remembered = { id, values }
}

/** Picks a built-in exercise and its key, position and the like. */
export function ExerciseDialog({ onOpen, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [exerciseId, setExerciseId] = useState(remembered.id)
  const [chosen, setChosen] = useState(remembered.values)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const id = useId()

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  const exercise = EXERCISES.find((item) => item.id === exerciseId) ?? EXERCISES[0]
  const values = { ...initialValues(exercise), ...chosen[exercise.id] }
  const groups = [...new Set(EXERCISES.map((item) => item.group))]

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    remember(exercise.id, chosen)
    setBusy(true)
    let problem: string | void
    try {
      problem = await onOpen(buildExercise(exercise, values))
    } catch {
      problem = 'The exercise could not be written out.'
    }
    setBusy(false)
    if (problem) setError(problem)
    else onClose()
  }

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
        <h2 id={`${id}-title`}>Exercises</h2>
        <label className="field">
          <span>Exercise</span>
          <select name="exercise" value={exercise.id} onChange={(event) => setExerciseId(event.target.value)}>
            {groups.map((group) => (
              <optgroup key={group} label={group}>
                {EXERCISES.filter((item) => item.group === group).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <p className="dialog-intro exercise-about">{exercise.about}</p>
        <div className="field-row exercise-options">
          {exercise.options.map((option) => (
            <label key={option.id} className="field">
              <span>{option.label}</span>
              <select
                name={option.id}
                value={values[option.id]}
                onChange={(event) =>
                  setChosen((all) => ({ ...all, [exercise.id]: { ...all[exercise.id], [option.id]: event.target.value } }))
                }
              >
                {option.choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-buttons">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            Open
          </button>
        </div>
      </form>
    </dialog>
  )
}
