import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { cleanListName, listsOf, MAX_LIST_NAME } from '../library/lists'
import type { Song } from '../library/types'

interface Props {
  song: Song
  /** Every list in the library. */
  lists: string[]
  /** Puts the song on a list, or takes it off; a new name makes a new list. */
  onChange: (name: string, on: boolean) => Promise<void>
  onClose: () => void
}

/** The lists one song is on, changed as the boxes are ticked. */
export function SongListsDialog({ song, lists, onChange, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Boxes ticked or cleared while their change is being saved, shown as they will be. */
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const on = listsOf(song)
  /**
   * Every list shown since the dialog opened: a list whose last song is
   * taken off here is gone from the library, but its box stays, to tick again.
   */
  const [seen, setSeen] = useState(lists)
  const shown = [...seen, ...lists.filter((list) => !seen.includes(list))]
  /** The box or button last used, given the keyboard back once saving no longer disables it. */
  const used = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  useEffect(() => {
    if (busy || !used.current) return
    used.current.focus()
    used.current = null
  }, [busy])

  /** Returns whether the change was saved. */
  const change = async (list: string, wanted: boolean): Promise<boolean> => {
    setBusy(true)
    setError(null)
    setPending((current) => ({ ...current, [list]: wanted }))
    // Saving disables the boxes and Add; the keyboard is put back on the one just used.
    const active = document.activeElement
    if (active instanceof HTMLElement && dialog.current?.contains(active)) used.current = active
    try {
      await onChange(list, wanted)
      if (!seen.includes(list)) setSeen((current) => (current.includes(list) ? current : [...current, list]))
      return true
    } catch {
      setError('The lists could not be saved in this browser.')
      return false
    } finally {
      setBusy(false)
      setPending((current) => {
        const next = { ...current }
        delete next[list]
        return next
      })
    }
  }

  const create = async (event: FormEvent) => {
    event.preventDefault()
    const clean = cleanListName(name)
    if (!clean) {
      setError('Give the list a name.')
      return
    }
    if (await change(clean, true)) setName('')
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
      <h2 id={`${id}-title`}>Lists for {song.title}</h2>
      {shown.length > 0 ? (
        <fieldset className="song-lists" disabled={busy}>
          <legend className="visually-hidden">Lists</legend>
          {shown.map((list) => (
            <label key={list} className="check">
              <input type="checkbox" checked={pending[list] ?? Object.hasOwn(on, list)} onChange={(event) => void change(list, event.target.checked)} />
              <span>{list}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="dialog-intro">Lists keep songs together in an order, such as "Working on" or "Gig set".</p>
      )}
      <form className="new-list" onSubmit={(event) => void create(event)}>
        <label className="field">
          <span>New list</span>
          <input value={name} maxLength={MAX_LIST_NAME} placeholder="Gig set" onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="submit" className="button" disabled={busy}>
          Add
        </button>
      </form>
      {error && (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-buttons">
        <button type="button" className="button primary" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  )
}
