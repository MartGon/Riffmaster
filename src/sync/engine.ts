import {
  applyRemoteSong,
  applyRemoteTake,
  clearMeta,
  clearPending,
  getMeta,
  markEverything,
  pendingChanges,
  readFile,
  setMeta,
} from '../library/syncStore'
import type { Song, TakeRecord } from '../library/types'

/** How far a device has read a table: the last row, ordered by when it changed on the server. */
export interface Cursor {
  modified: string
  id: string
}

export interface RemoteSongRow {
  id: string
  updatedAt: number
  record: Song
  modified: string
}

export interface RemoteTakeRow {
  id: string
  songId: string
  /** Null for a removed take. */
  record: TakeRecord | null
  modified: string
}

/** Where devices leave their changes for each other: Supabase, or a stand-in in tests. */
export interface Remote {
  userId: string
  /** Rows changed after `after`, oldest first, at most `limit`. */
  pullSongs(after: Cursor | null, limit: number): Promise<RemoteSongRow[]>
  pullTakes(after: Cursor | null, limit: number): Promise<RemoteTakeRow[]>
  /** Keeps the newer of two versions of each song. */
  pushSongs(rows: { id: string; updatedAt: number; record: Song }[]): Promise<void>
  /** Adds takes; a removal is final. */
  pushTakes(rows: { id: string; songId: string; record: TakeRecord | null }[]): Promise<void>
  /** Stores a file under its hash. Storing one that is already there does nothing. */
  upload(hash: string, data: ArrayBuffer): Promise<void>
  download(hash: string): Promise<ArrayBuffer>
}

const PAGE = 500
const CHUNK = 200
/**
 * Rows are read again from a little before where the last run stopped: a
 * row written by a slow push from another device can show up with a time
 * just before rows already read. Reading a row twice does no harm.
 */
const OVERLAP_MS = 5 * 60 * 1000

function rewind(cursor: Cursor | undefined): Cursor | null {
  if (!cursor) return null
  const time = Date.parse(cursor.modified)
  if (Number.isNaN(time)) return null
  return { modified: new Date(time - OVERLAP_MS).toISOString(), id: '' }
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export interface SyncResult {
  /** Whether anything from another device changed the library here. */
  changed: boolean
  sent: number
  received: number
}

/**
 * One full exchange with the remote: takes in what other devices sent,
 * then sends what changed here. Safe to stop at any point; the next run
 * picks up from where this one got to.
 */
export async function syncOnce(remote: Remote): Promise<SyncResult> {
  const result: SyncResult = { changed: false, sent: 0, received: 0 }

  // Another account on this device starts from scratch: nothing it has is known to have been sent.
  if ((await getMeta<string>('user')) !== remote.userId) {
    await clearMeta()
    await markEverything()
    await setMeta('user', remote.userId)
  }

  // Songs first, so a take's song is here before the take.
  let complete = true
  let cursor = rewind(await getMeta<Cursor>('cursor:songs'))
  let last: Cursor | null = null
  for (;;) {
    const rows = await remote.pullSongs(cursor, PAGE)
    for (const row of rows) {
      const record: Song = { ...row.record, id: row.id, updatedAt: row.updatedAt }
      if (await applyRemoteSong(record, (hash) => remote.download(hash))) {
        result.changed = true
        result.received++
      }
      cursor = last = { modified: row.modified, id: row.id }
    }
    if (rows.length < PAGE) break
  }
  if (last) await setMeta('cursor:songs', last)

  cursor = rewind(await getMeta<Cursor>('cursor:takes'))
  last = null
  for (;;) {
    const rows = await remote.pullTakes(cursor, PAGE)
    for (const row of rows) {
      const applied = await applyRemoteTake(row.id, row.songId, row.record)
      if (applied === 'changed') {
        result.changed = true
        result.received++
      }
      // A take whose song could not be taken in is read again next time.
      if (applied === 'no-song') complete = false
      cursor = { modified: row.modified, id: row.id }
      if (complete) last = cursor
    }
    if (rows.length < PAGE) break
  }
  if (last) await setMeta('cursor:takes', last)

  const pending = await pendingChanges()
  const songs = pending.songs.filter((entry) => entry.song)
  for (const { song } of songs) {
    if (!song || song.deletedAt !== null) continue
    const sentKey = `sent:${song.hash}`
    if (await getMeta<boolean>(sentKey)) continue
    const data = await readFile(song.id)
    if (!data) continue
    await remote.upload(song.hash, data)
    await setMeta(sentKey, true)
  }
  for (const batch of chunks(songs, CHUNK)) {
    await remote.pushSongs(batch.map(({ id, song }) => ({ id, updatedAt: song!.updatedAt, record: song! })))
    await clearPending(batch)
    result.sent += batch.length
  }
  // A song missing altogether has nothing to send.
  await clearPending(pending.songs.filter((entry) => !entry.song))
  const takes = pending.takes.filter((entry) => entry.songId)
  for (const batch of chunks(takes, CHUNK)) {
    await remote.pushTakes(batch.map(({ id, songId, take }) => ({ id, songId, record: take })))
    await clearPending(batch)
    result.sent += batch.length
  }
  await clearPending(pending.takes.filter((entry) => !entry.songId))
  return result
}
