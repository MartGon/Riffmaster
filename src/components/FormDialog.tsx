import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

export type FieldValue = string

export interface Field {
  name: string
  label: string
  type: 'text' | 'number' | 'select'
  /** For selects: the choices, as value and label. */
  options?: { value: string; label: string }[]
  min?: number
  max?: number
  required?: boolean
  /** Fields with the same group sit side by side. */
  group?: string
}

interface Props {
  title: string
  fields: Field[]
  initial: Record<string, FieldValue>
  submitLabel: string
  /** Extra text under the title. */
  intro?: ReactNode
  /** Lets one field fill in others, e.g. a tuning preset setting each string. */
  onFieldChange?: (name: string, value: FieldValue, values: Record<string, FieldValue>) => Record<string, FieldValue>
  /** Returns an error message to keep the dialog open, or nothing to close it. */
  onSubmit: (values: Record<string, FieldValue>) => string | void | Promise<string | void>
  onClose: () => void
}

/** A modal form. It opens when mounted; Escape or Cancel closes it. */
export function FormDialog({ title, fields, initial, submitLabel, intro, onFieldChange, onSubmit, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [values, setValues] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const id = useId()

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  const change = (name: string, value: FieldValue) => {
    setValues((current) => {
      const next = { ...current, [name]: value }
      return onFieldChange ? { ...next, ...onFieldChange(name, value, next) } : next
    })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    const problem = await onSubmit(values)
    setBusy(false)
    if (problem) setError(problem)
    else onClose()
  }

  const groups: Field[][] = []
  for (const field of fields) {
    const last = groups[groups.length - 1]
    if (field.group && last?.[0]?.group === field.group) last.push(field)
    else groups.push([field])
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
        <h2 id={`${id}-title`}>{title}</h2>
        {intro && <div className="dialog-intro">{intro}</div>}
        {groups.map((group) => (
          <div key={group[0].name} className={group.length > 1 ? 'field-row' : undefined}>
            {group.map((field) => (
              <label key={field.name} className="field">
                <span>{field.label}</span>
                {field.type === 'select' ? (
                  <select value={values[field.name] ?? ''} onChange={(event) => change(field.name, event.target.value)}>
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type}
                    inputMode={field.type === 'number' ? 'numeric' : undefined}
                    value={values[field.name] ?? ''}
                    min={field.min}
                    max={field.max}
                    required={field.required}
                    onChange={(event) => change(field.name, event.target.value)}
                  />
                )}
              </label>
            ))}
          </div>
        ))}
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
            {submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}

interface ChoiceProps {
  title: string
  children: ReactNode
  choices: { label: string; primary?: boolean; onChoose: () => void }[]
  onClose: () => void
}

/** A modal question with a few buttons, e.g. Save / Discard / Cancel. */
export function ChoiceDialog({ title, children, choices, onClose }: ChoiceProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])
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
      <h2 id={`${id}-title`}>{title}</h2>
      <div className="dialog-intro">{children}</div>
      <div className="dialog-buttons">
        {choices.map((choice) => (
          <button
            key={choice.label}
            type="button"
            className={choice.primary ? 'button primary' : 'button'}
            onClick={choice.onChoose}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </dialog>
  )
}

interface MenuProps {
  title: string
  items: { label: string; disabled?: boolean; onChoose: () => void }[]
  onClose: () => void
}

/** A modal list of actions. Choosing one closes the list first. */
export function MenuDialog({ title, items, onClose }: MenuProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])
  return (
    <dialog
      ref={dialog}
      className="dialog menu-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <h2 id={`${id}-title`}>{title}</h2>
      <div className="menu-items">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onChoose()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="dialog-buttons">
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  )
}
