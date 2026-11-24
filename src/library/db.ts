import { randomId, sha256 } from '../lib/ids'
import { type DBSchema, type IDBPDatabase, openDB } from 'idb'
import { sameLists } from './lists'
import { defaultSongSettings, type Song, type SongSettings, type TakeRecord } from './types'

/**
 * A change made on this device that sync has not sent yet. Keyed by
 * `song:<id>` or `take:<id>`; the current record is read when it is sent,
 * and a take that is no longer there is sent as removed.
 */
export interface Pending {
  /** Changes with every new change, so an entry is only cleared if nothing changed while it was sent. */
  stamp: string
  /** For takes: the song the take belongs to. */
  songId?: string
}

export interface LibrarySchema extends DBSchema {
  songs: { key: string; value: Song; indexes: { hash: string } }
  files: { key: string; value: ArrayBuffer }
  takes: { key: string; value: TakeRecord; indexes: { songId: string } }
  outbox: { key: string; value: Pending }
  /** What sync remembers between runs: who is signed in, how far it has read, which files it sent. */
  syncMeta: { key: string; value: unknown }
}

/** The outbox store, in whichever transaction is writing to it. */
interface Outbox {
  put(value: Pending, key: string): Promise<string>
}

let stampCount = 0
function stamp(): string {
  return `${Date.now()}.${++stampCount}`
}

/** Notes a change for sync to send. Changes made by sync itself from another device are not noted. */
export function markSong(outbox: Outbox, id: string): Promise<string> {
  return outbox.put({ stamp: stamp() }, `song:${id}`)
}

export function markTake(outbox: Outbox, take: Pick<TakeRecord, 'id' | 'songId'>): Promise<string> {
  return outbox.put({ stamp: stamp(), songId: take.songId }, `take:${take.id}`)
}

const changeListeners = new Set<() => void>()

/** Calls `listener` after each change on this device that sync should send. */
export function onLocalChange(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

function changed(): void {
  for (const listener of changeListeners) listener()
}

let dbPromise: Promise<IDBPDatabase<LibrarySchema>> | null = null
let onBlocked: (() => void) | null = null

/**
 * Sets what happens when the library cannot be opened because another tab
 * still has an older version of it open. Opening continues by itself once
 * that tab is closed.
 */
export function setBlockedHandler(handler: (() => void) | null): void {
  onBlocked = handler
}

export function db(): Promise<IDBPDatabase<LibrarySchema>> {
  dbPromise ??= openDB<LibrarySchema>('riffmaster', 3, {
    async upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        const songs = database.createObjectStore('songs', { keyPath: 'id' })
        songs.createIndex('hash', 'hash')
        database.createObjectStore('files')
      }
      if (oldVersion < 2) {
        const takes = database.createObjectStore('takes', { keyPath: 'id' })
        takes.createIndex('songId', 'songId')
      }
      if (oldVersion < 3) {
        // Everything already in the library is still to be sent.
        const outbox = database.createObjectStore('outbox')
        database.createObjectStore('syncMeta')
        for (const song of await transaction.objectStore('songs').getAll()) await markSong(outbox, song.id)
        for (const take of await transaction.objectStore('takes').getAll()) await markTake(outbox, take)
      }
    },
    blocked() {
      onBlocked?.()
    },
    // A newer version of the app in another tab wants to upgrade the
    // library: let go of it, so that tab is not left waiting for this one.
    blocking(_current, _blocked, event) {
      ;(event.target as IDBDatabase).close()
      dbPromise = null
    },
  })
  return dbPromise
}

/** Closes the connection so the next call reopens it. Used by tests. */
export async function resetConnection(): Promise<void> {
  if (dbPromise) (await dbPromise).close()
  dbPromise = null
}


/** Songs that have not been deleted, most recently opened first. */
export async function listSongs(): Promise<Song[]> {
  const all = await (await db()).getAll('songs')
  return all
    .filter((song) => song.deletedAt === null)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
}

export interface NewSong {
  title: string
  artist: string
  fileName: string
  data: ArrayBuffer
}

/**
 * Adds a file to the library. Adding a file that is already there returns
 * the existing song instead of a duplicate, restoring it if it was deleted.
 */
export async function addSong(input: NewSong, now = Date.now()): Promise<Song> {
  const hash = await sha256(input.data)
  const database = await db()
  const tx = database.transaction(['songs', 'files', 'outbox'], 'readwrite')
  const existing = (await tx.objectStore('songs').index('hash').getAll(hash)).sort(
    (a, b) => Number(a.deletedAt !== null) - Number(b.deletedAt !== null),
  )[0]
  let song: Song
  if (existing) {
    song = { ...existing, deletedAt: null, updatedAt: now, lastOpenedAt: now }
    // Back from the bin it is on no list: those it was on may be gone or renamed since.
    if (existing.deletedAt !== null) delete song.lists
  } else {
    song = {
      id: randomId(),
      title: input.title,
      artist: input.artist,
      fileName: input.fileName,
      size: input.data.byteLength,
      hash,
      addedAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      deletedAt: null,
      settings: { ...defaultSongSettings },
    }
  }
  delete song.mergedInto
  await tx.objectStore('songs').put(song)
  await tx.objectStore('files').put(input.data, song.id)
  await markSong(tx.objectStore('outbox'), song.id)
  await tx.done
  changed()
  return song
}

/** Returns the song and its file, and records that it was opened. */
export async function openSong(
  id: string,
  now = Date.now(),
): Promise<{ song: Song; data: ArrayBuffer } | null> {
  const database = await db()
  const tx = database.transaction(['songs', 'files'], 'readwrite')
  const song = await tx.objectStore('songs').get(id)
  const data = await tx.objectStore('files').get(id)
  if (!song || song.deletedAt !== null || !data) {
    await tx.done
    return null
  }
  // Opening is not an edit, so `updatedAt` stays as it is.
  const opened = { ...song, lastOpenedAt: now }
  await tx.objectStore('songs').put(opened)
  await tx.done
  return { song: opened, data }
}

export async function saveSongSettings(
  id: string,
  settings: SongSettings,
  now = Date.now(),
): Promise<void> {
  const database = await db()
  const tx = database.transaction(['songs', 'outbox'], 'readwrite')
  const songs = tx.objectStore('songs')
  const song = await songs.get(id)
  if (song && song.deletedAt === null && JSON.stringify(song.settings) !== JSON.stringify(settings)) {
    await songs.put({ ...song, settings, updatedAt: now })
    await markSong(tx.objectStore('outbox'), id)
    await tx.done
    changed()
    return
  }
  await tx.done
}

/** Puts songs on lists or takes them off, all at once; `undefined` leaves a song on no list. */
export async function saveSongLists(changes: Map<string, Record<string, number> | undefined>, now = Date.now()): Promise<void> {
  if (changes.size === 0) return
  const tx = (await db()).transaction(['songs', 'outbox'], 'readwrite')
  const songs = tx.objectStore('songs')
  let any = false
  for (const [id, lists] of changes) {
    const song = await songs.get(id)
    if (!song || song.deletedAt !== null || sameLists(song.lists, lists)) continue
    const next: Song = { ...song, updatedAt: now }
    if (lists) next.lists = lists
    else delete next.lists
    await songs.put(next)
    await markSong(tx.objectStore('outbox'), id)
    any = true
  }
  await tx.done
  if (any) changed()
}

/** Sets the tuning shift a song plays in, leaving its other settings as they are. */
export async function saveSongPitch(id: string, pitch: number, now = Date.now()): Promise<void> {
  const tx = (await db()).transaction(['songs', 'outbox'], 'readwrite')
  const song = await tx.objectStore('songs').get(id)
  if (song && song.deletedAt === null && (song.settings.pitch ?? 0) !== pitch) {
    const settings = { ...song.settings }
    if (pitch === 0) delete settings.pitch
    else settings.pitch = pitch
    await tx.objectStore('songs').put({ ...song, settings, updatedAt: now })
    await markSong(tx.objectStore('outbox'), id)
    await tx.done
    changed()
    return
  }
  await tx.done
}

/** Where the file a song had before it was first edited is kept. */
export function originalKey(id: string): string {
  return `original:${id}`
}

/**
 * Replaces a song's file with an edited version. The file it had before its
 * first edit is kept, so it can be restored. Returns the updated song, or
 * null if the song is no longer in the library.
 */
export async function saveEditedSong(
  id: string,
  data: ArrayBuffer,
  info: { title: string; artist: string },
  now = Date.now(),
): Promise<Song | null> {
  const hash = await sha256(data)
  const database = await db()
  const tx = database.transaction(['songs', 'files', 'outbox'], 'readwrite')
  const songs = tx.objectStore('songs')
  const files = tx.objectStore('files')
  const song = await songs.get(id)
  if (!song || song.deletedAt !== null) {
    await tx.done
    return null
  }
  if ((await files.getKey(originalKey(id))) === undefined) {
    const current = await files.get(id)
    if (current) await files.put(current, originalKey(id))
  }
  await files.put(data, id)
  const saved: Song = { ...song, ...info, size: data.byteLength, hash, updatedAt: now }
  await songs.put(saved)
  await markSong(tx.objectStore('outbox'), id)
  await tx.done
  changed()
  return saved
}

/** Whether a song has been edited and its original file is still kept. */
export async function hasOriginal(id: string): Promise<boolean> {
  return (await (await db()).getKey('files', originalKey(id))) !== undefined
}

/**
 * Puts back the file a song had before it was first edited, and forgets
 * that copy. `describe` reads the title and artist from the file. Returns
 * the restored file, or null if there is none.
 */
export async function restoreOriginal(
  id: string,
  describe: (data: ArrayBuffer) => { title: string; artist: string },
  now = Date.now(),
): Promise<ArrayBuffer | null> {
  const original = await (await db()).get('files', originalKey(id))
  if (!original) return null
  const info = describe(original)
  const hash = await sha256(original)
  const tx = (await db()).transaction(['songs', 'files', 'outbox'], 'readwrite')
  const song = await tx.objectStore('songs').get(id)
  if (!song || song.deletedAt !== null) {
    await tx.done
    return null
  }
  await tx.objectStore('files').put(original, id)
  await tx.objectStore('files').delete(originalKey(id))
  await tx
    .objectStore('songs')
    .put({ ...song, ...info, size: original.byteLength, hash, updatedAt: now })
  await markSong(tx.objectStore('outbox'), id)
  await tx.done
  changed()
  return original
}

/** Removes the file and the practice history, and leaves a deletion marker on the song record. */
export async function deleteSong(id: string, now = Date.now()): Promise<void> {
  const database = await db()
  const tx = database.transaction(['songs', 'files', 'takes', 'outbox'], 'readwrite')
  const outbox = tx.objectStore('outbox')
  const song = await tx.objectStore('songs').get(id)
  if (song) {
    // A deleted song leaves its lists, so it cannot bring one back later.
    const { lists: _lists, ...rest } = song
    await tx.objectStore('songs').put({ ...rest, deletedAt: now, updatedAt: now })
    await markSong(outbox, id)
  }
  await tx.objectStore('files').delete(id)
  await tx.objectStore('files').delete(originalKey(id))
  for (const take of await tx.objectStore('takes').index('songId').getAll(id)) {
    await tx.objectStore('takes').delete(take.id)
    await markTake(outbox, take)
  }
  await tx.done
  changed()
}

/** Records a finished practice take. */
export async function addTake(take: Omit<TakeRecord, 'id'>): Promise<TakeRecord> {
  const record: TakeRecord = { ...take, id: randomId() }
  const tx = (await db()).transaction(['takes', 'outbox'], 'readwrite')
  await tx.objectStore('takes').put(record)
  await markTake(tx.objectStore('outbox'), record)
  await tx.done
  changed()
  return record
}

/** A song's practice takes, oldest first. */
export async function listTakes(songId: string): Promise<TakeRecord[]> {
  const takes = await (await db()).getAllFromIndex('takes', 'songId', songId)
  return takes.sort((a, b) => a.at - b.at)
}

/** Every practice take in the library, oldest first. */
export async function listAllTakes(): Promise<TakeRecord[]> {
  const takes = await (await db()).getAll('takes')
  return takes.sort((a, b) => a.at - b.at)
}

/** Forgets a song's practice takes for one track. */
export async function clearTakes(songId: string, trackIndex: number): Promise<void> {
  const tx = (await db()).transaction(['takes', 'outbox'], 'readwrite')
  const takes = tx.objectStore('takes')
  for (const take of await takes.index('songId').getAll(songId)) {
    if (take.trackIndex !== trackIndex) continue
    await takes.delete(take.id)
    await markTake(tx.objectStore('outbox'), take)
  }
  await tx.done
  changed()
}

