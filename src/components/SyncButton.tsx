import { type FormEvent, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { getSyncState, onSyncState, signIn, signOut, type SyncState, syncNow } from '../sync/sync'
import { Icon, type IconName } from './Icon'

const icons: Record<SyncState['status'], IconName> = {
  unavailable: 'cloud',
  starting: 'cloud',
  'signed-out': 'cloud',
  syncing: 'syncing',
  synced: 'cloudDone',
  offline: 'cloudOff',
  error: 'cloudAlert',
}

function ago(time: number | null): string {
  if (!time) return 'not yet'
  const minutes = Math.round((Date.now() - time) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  return new Date(time).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

function summary(state: SyncState): string {
  switch (state.status) {
    case 'signed-out':
    case 'starting':
      return 'Sync is off'
    case 'syncing':
      return 'Syncing…'
    case 'synced':
      return `Synced ${ago(state.lastSyncedAt)}`
    case 'offline':
      return 'Offline: changes are kept and sent when back online'
    case 'error':
      return 'Sync failed'
    default:
      return ''
  }
}

/** The sync status in the top bar; opens the sign-in and sync details. */
export function SyncButton() {
  const state = useSyncExternalStore(onSyncState, getSyncState, getSyncState)
  const [open, setOpen] = useState(false)
  if (state.status === 'unavailable') return null
  const label = summary(state)
  return (
    <>
      <button
        type="button"
        className={`icon-button sync-button sync-${state.status}`}
        aria-label={`${label}. Sync settings`}
        title={label}
        onClick={() => setOpen(true)}
      >
        <Icon name={icons[state.status]} />
      </button>
      {open && <SyncDialog state={state} onClose={() => setOpen(false)} />}
    </>
  )
}

function SyncDialog({ state, onClose }: { state: SyncState; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])
  const signedIn = state.status !== 'signed-out' && state.status !== 'starting'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    const error = await signIn(email, password)
    setBusy(false)
    setProblem(error)
    if (!error) setPassword('')
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
      <h2 id={`${id}-title`}>Sync</h2>
      {signedIn ? (
        <>
          <div className="dialog-intro">
            <p className="sync-status" role="status">
              {summary(state)}
            </p>
            {state.status === 'error' && state.error && <p className="dialog-error">{state.error}</p>}
            <p>
              Signed in as <strong>{state.email}</strong>. Songs, their settings and practice history are kept the
              same on every device signed in to this account. Each device keeps its own copy, so the app works
              without a connection.
            </p>
          </div>
          <div className="dialog-buttons">
            <button type="button" className="button" onClick={() => void signOut()}>
              Sign out
            </button>
            <button
              type="button"
              className="button"
              disabled={state.status === 'syncing'}
              onClick={() => void syncNow()}
            >
              Sync now
            </button>
            <button type="button" className="button primary" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <div className="dialog-intro">
            Sign in to keep your library the same on all your devices. This is optional: without it, the library
            stays in this browser and everything works offline as before.
          </div>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {problem && (
            <p className="dialog-error" role="alert">
              {problem}
            </p>
          )}
          <div className="dialog-buttons">
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
