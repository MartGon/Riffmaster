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

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  const change = async (list: string, wanted: boolean) => {
    setBusy(true)
    setError(null)
    setPending((current) => ({ ...current, [list]: wanted }))
    try {
      await onChange(list, wanted)
    } catch {
      setError('The lists could not be saved in this browser.')
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
    await change(clean, true)
    setName('')
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
      {lists.length > 0 ? (
        <fieldset className="song-lists" disabled={busy}>
          <legend className="visually-hidden">Lists</legend>
          {lists.map((list) => (
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
