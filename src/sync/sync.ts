import type { SupabaseClient } from '@supabase/supabase-js'
import { onLocalChange } from '../library/db'
import { syncOnce } from './engine'

/**
 * Optional sync of the library between devices through Supabase. The
 * library on each device is the real copy and works without it; sync only
 * runs while signed in and online, and catches up when the connection is
 * back. It is offered only in builds given a Supabase project
 * (NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''
const syncAvailable = URL !== '' && KEY !== ''

/** Where the sign-in is kept; its presence means the Supabase code is worth loading at start. */
const AUTH_KEY = 'riffmaster.sync.auth'
const LAST_KEY = 'riffmaster.sync.last'

const AFTER_CHANGE_MS = 3000
const EVERY_MS = 5 * 60 * 1000
const ON_RETURN_MS = 60 * 1000

export type SyncStatus = 'unavailable' | 'starting' | 'signed-out' | 'syncing' | 'synced' | 'offline' | 'error'

export interface SyncState {
  status: SyncStatus
  email: string | null
  /** When the last full exchange finished, in ms since the epoch. */
  lastSyncedAt: number | null
  error: string | null
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

let state: SyncState = {
  status: syncAvailable ? 'starting' : 'unavailable',
  email: null,
  lastSyncedAt: null,
  error: null,
}
const listeners = new Set<() => void>()

function update(change: Partial<SyncState>): void {
  state = { ...state, ...change }
  for (const listener of listeners) listener()
}

export function getSyncState(): SyncState {
  return state
}

export function onSyncState(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

let clientPromise: Promise<SupabaseClient> | null = null
function client(): Promise<SupabaseClient> {
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(URL, KEY, {
      auth: { storageKey: AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    }),
  )
  return clientPromise
}

/** A message for a failed run, or null when the device is simply offline. */
function describe(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof TypeError || /fetch|network|load failed/i.test(message)) return null
  if (/schema cache|does not exist|push_songs|bucket not found/i.test(message)) {
    return 'The sync tables are missing in Supabase. Run supabase/schema.sql in its SQL Editor.'
  }
  return message
}

let running: Promise<void> | null = null
let again = false
let onChanged: () => void = () => {}

/** Runs one exchange now, or straight after the one under way. */
export function syncNow(): Promise<void> {
  if (!syncAvailable) return Promise.resolve()
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    try {
      do {
        again = false
        await runOnce()
      } while (again)
    } finally {
      running = null
    }
  })()
  return running
}

async function runOnce(): Promise<void> {
  if (stored(AUTH_KEY) === null) {
    update({ status: 'signed-out', email: null })
    return
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    update({ status: 'offline' })
    return
  }
  try {
    const supabase = await client()
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    const session = data.session
    if (!session) {
      update({ status: 'signed-out', email: null })
      return
    }
    update({ status: 'syncing', email: session.user.email ?? null, error: null })
    const { supabaseRemote } = await import('./supabaseRemote')
    const result = await syncOnce(supabaseRemote(supabase, session.user.id))
    const now = Date.now()
    try {
      localStorage.setItem(LAST_KEY, String(now))
    } catch {
      // Only the "last synced" time is lost.
    }
    update({ status: 'synced', lastSyncedAt: now, error: null })
    if (result.changed) onChanged()
  } catch (error) {
    const problem = describe(error)
    update(problem ? { status: 'error', error: problem } : { status: 'offline', error: null })
  }
}

let started = false

/**
 * Starts syncing in the background if signed in. `changed` is called when
 * changes from another device have arrived. Returns a function that stops it.
 */
export function startSync(changed: () => void): () => void {
  onChanged = changed
  if (!syncAvailable || started) return () => {}
  started = true
  const last = Number(stored(LAST_KEY))
  update({ lastSyncedAt: Number.isFinite(last) && last > 0 ? last : null })

  let timer: number | undefined
  const soon = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void syncNow(), AFTER_CHANGE_MS)
  }
  const stopChanges = onLocalChange(soon)
  const onOnline = () => void syncNow()
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return
    if (Date.now() - (state.lastSyncedAt ?? 0) > ON_RETURN_MS) void syncNow()
  }
  window.addEventListener('online', onOnline)
  const onOffline = () => {
    if (state.status !== 'signed-out') update({ status: 'offline' })
  }
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisible)
  const every = window.setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow()
  }, EVERY_MS)
  void syncNow()

  return () => {
    started = false
    stopChanges()
    window.clearTimeout(timer)
    window.clearInterval(every)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

/** Signs in with the account made in the Supabase dashboard, then syncs. Returns an error message on failure. */
export async function signIn(email: string, password: string): Promise<string | null> {
  try {
    const supabase = await client()
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) return error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message
  } catch (error) {
    return describe(error) ?? 'Could not reach the sync server. Check the connection and try again.'
  }
  update({ status: 'syncing', email: email.trim(), error: null })
  void syncNow()
  return null
}

/** Stops syncing on this device. The library stays as it is. */
export async function signOut(): Promise<void> {
  try {
    await (await client()).auth.signOut({ scope: 'local' })
  } catch {
    // Signed out here regardless; the sign-in is forgotten below.
  }
  try {
    localStorage.removeItem(AUTH_KEY)
  } catch {
    // Nothing more to forget.
  }
  update({ status: 'signed-out', email: null, error: null })
}
