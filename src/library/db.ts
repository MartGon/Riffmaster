import { randomId, sha256 } from '../lib/ids'
import { type DBSchema, type IDBPDatabase, openDB } from 'idb'
import { defaultSongSettings, type Song, type SongSettings, type TakeRecord } from './types'

interface LibrarySchema extends DBSchema {
  songs: { key: string; value: Song; indexes: { hash: string } }
  files: { key: string; value: ArrayBuffer }
  takes: { key: string; value: TakeRecord; indexes: { songId: string } }
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

function db(): Promise<IDBPDatabase<LibrarySchema>> {
  dbPromise ??= openDB<LibrarySchema>('riffmaster', 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const songs = database.createObjectStore('songs', { keyPath: 'id' })
        songs.createIndex('hash', 'hash')
        database.createObjectStore('files')
      }
      if (oldVersion < 2) {
        const takes = database.createObjectStore('takes', { keyPath: 'id' })
        takes.createIndex('songId', 'songId')
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
  const tx = database.transaction(['songs', 'files'], 'readwrite')
  const existing = await tx.objectStore('songs').index('hash').get(hash)
  let song: Song
  if (existing) {
    song = { ...existing, deletedAt: null, updatedAt: now, lastOpenedAt: now }
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
  await tx.objectStore('songs').put(song)
  await tx.objectStore('files').put(input.data, song.id)
  await tx.done
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
  const tx = database.transaction('songs', 'readwrite')
  const song = await tx.store.get(id)
  if (song && song.deletedAt === null) {
    await tx.store.put({ ...song, settings, updatedAt: now })
  }
  await tx.done
}

/** Where the file a song had before it was first edited is kept. */
function originalKey(id: string): string {
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
  const tx = database.transaction(['songs', 'files'], 'readwrite')
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
  await tx.done
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
  const tx = (await db()).transaction(['songs', 'files'], 'readwrite')
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
  await tx.done
  return original
}

/** Removes the file and the practice history, and leaves a deletion marker on the song record. */
export async function deleteSong(id: string, now = Date.now()): Promise<void> {
  const database = await db()
  const tx = database.transaction(['songs', 'files', 'takes'], 'readwrite')
  const song = await tx.objectStore('songs').get(id)
  if (song) {
    await tx.objectStore('songs').put({ ...song, deletedAt: now, updatedAt: now })
  }
  await tx.objectStore('files').delete(id)
  await tx.objectStore('files').delete(originalKey(id))
  for (const key of await tx.objectStore('takes').index('songId').getAllKeys(id)) {
    await tx.objectStore('takes').delete(key)
  }
  await tx.done
}

/** Records a finished practice take. */
export async function addTake(take: Omit<TakeRecord, 'id'>): Promise<TakeRecord> {
  const record: TakeRecord = { ...take, id: randomId() }
  await (await db()).put('takes', record)
  return record
}

/** A song's practice takes, oldest first. */
export async function listTakes(songId: string): Promise<TakeRecord[]> {
  const takes = await (await db()).getAllFromIndex('takes', 'songId', songId)
  return takes.sort((a, b) => a.at - b.at)
}

/** Forgets a song's practice takes for one track. */
export async function clearTakes(songId: string, trackIndex: number): Promise<void> {
  const tx = (await db()).transaction('takes', 'readwrite')
  for (const take of await tx.store.index('songId').getAll(songId)) {
    if (take.trackIndex === trackIndex) await tx.store.delete(take.id)
  }
  await tx.done
}

export interface SongPractice {
  takes: number
  /** Best accuracy among the takes, from 0 to 1. */
  best: number
}

/** How much each song has been practised, keyed by song id. */
export async function practiceBySong(): Promise<Map<string, SongPractice>> {
  const totals = new Map<string, SongPractice>()
  for (const take of await (await db()).getAll('takes')) {
    const entry = totals.get(take.songId) ?? { takes: 0, best: 0 }
    entry.takes++
    entry.best = Math.max(entry.best, take.accuracy)
    totals.set(take.songId, entry)
  }
  return totals
}
