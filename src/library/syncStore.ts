import { db, markSong, markTake, originalKey, type Pending } from './db'
import type { Song, TakeRecord } from './types'
import { mergeLists, sameLists } from './lists'

/**
 * The library's side of sync: what is waiting to be sent, and taking in
 * what other devices sent. Changes taken in from other devices are not
 * sent back, except where taking them in changes something else, such as
 * two copies of one file being merged.
 */

export interface PendingSong {
  key: string
  stamp: string
  id: string
  /** Missing if the song is gone from this device altogether. */
  song: Song | undefined
}

export interface PendingTake {
  key: string
  stamp: string
  id: string
  songId: string
  /** Null for a take that was removed. */
  take: TakeRecord | null
}

export async function pendingChanges(): Promise<{ songs: PendingSong[]; takes: PendingTake[] }> {
  const tx = (await db()).transaction(['outbox', 'songs', 'takes'])
  const keys = await tx.objectStore('outbox').getAllKeys()
  const entries = await tx.objectStore('outbox').getAll()
  const songs: PendingSong[] = []
  const takes: PendingTake[] = []
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const { stamp, songId } = entries[i]
    const id = key.slice(5)
    if (key.startsWith('song:')) {
      songs.push({ key, stamp, id, song: await tx.objectStore('songs').get(id) })
    } else if (key.startsWith('take:')) {
      const take = (await tx.objectStore('takes').get(id)) ?? null
      takes.push({ key, stamp, id, songId: take?.songId ?? songId ?? '', take })
    }
  }
  await tx.done
  return { songs, takes }
}

/** Forgets sent changes, unless they changed again while being sent. */
export async function clearPending(sent: { key: string; stamp: string }[]): Promise<void> {
  const tx = (await db()).transaction('outbox', 'readwrite')
  for (const { key, stamp } of sent) {
    if ((await tx.store.get(key))?.stamp === stamp) await tx.store.delete(key)
  }
  await tx.done
}

/** Marks everything in the library as still to be sent, e.g. for a different account. */
export async function markEverything(): Promise<void> {
  const tx = (await db()).transaction(['songs', 'takes', 'outbox'], 'readwrite')
  const outbox = tx.objectStore('outbox')
  for (const song of await tx.objectStore('songs').getAll()) await markSong(outbox, song.id)
  for (const take of await tx.objectStore('takes').getAll()) await markTake(outbox, take)
  await tx.done
}

export async function readFile(id: string): Promise<ArrayBuffer | undefined> {
  return (await db()).get('files', id)
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('syncMeta', key)) as T | undefined
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('syncMeta', value, key)
}

/** Forgets all of sync's own notes: how far it has read and which files it sent. */
export async function clearMeta(): Promise<void> {
  await (await db()).clear('syncMeta')
}

/** A file already on this device with the given contents, if any. */
async function localFile(hash: string): Promise<ArrayBuffer | undefined> {
  const database = await db()
  for (const song of await database.getAllFromIndex('songs', 'hash', hash)) {
    const data = await database.get('files', song.id)
    if (data) return data
  }
  return undefined
}

/** The parts of the takes and outbox stores used here, in whichever transaction is writing. */
interface TakeStore {
  get(key: string): Promise<TakeRecord | undefined>
  put(value: TakeRecord): Promise<string>
  delete(key: string): Promise<void>
  index(name: 'songId'): { getAll(query: string): Promise<TakeRecord[]> }
}

interface OutboxStore {
  get(key: string): Promise<Pending | undefined>
  put(value: Pending, key: string): Promise<string>
}

/** The id a take gets when its song is merged into another; the same on every device. */
function movedTakeId(id: string): string {
  return `${id}.m`
}

/** Moves a song's takes to the song it was merged into. */
async function moveTakes(takes: TakeStore, outbox: OutboxStore, from: string, to: string) {
  for (const take of await takes.index('songId').getAll(from)) {
    await moveTake(takes, outbox, take, to)
    await takes.delete(take.id)
  }
}

async function moveTake(takes: TakeStore, outbox: OutboxStore, take: TakeRecord, to: string) {
  const moved = { ...take, id: movedTakeId(take.id), songId: to }
  if (!(await takes.get(moved.id)) && !(await outbox.get(`take:${moved.id}`))) {
    await takes.put(moved)
    await markTake(outbox, moved)
  }
  await markTake(outbox, take)
}

/**
 * Takes in a song from another device. The newer version of a song wins.
 * `download` fetches a file this device does not have. Two songs with the
 * same file, added separately on two devices, become one: the one with
 * the smaller id is kept on every device. Returns whether anything changed.
 */
export async function applyRemoteSong(
  remote: Song,
  download: (hash: string) => Promise<ArrayBuffer>,
  now = Date.now(),
): Promise<boolean> {
  const database = await db()
  const before = await database.get('songs', remote.id)
  if (before && before.updatedAt >= remote.updatedAt) return false
  const live = remote.deletedAt === null
  const data = live ? ((await localFile(remote.hash)) ?? (await download(remote.hash))) : undefined

  const tx = database.transaction(['songs', 'files', 'takes', 'outbox'], 'readwrite')
  const songs = tx.objectStore('songs')
  const files = tx.objectStore('files')
  const takes = tx.objectStore('takes')
  const outbox = tx.objectStore('outbox')
  const local = await songs.get(remote.id)
  // Changed here while the file was downloading.
  if (local && local.updatedAt >= remote.updatedAt) {
    await tx.done
    return false
  }
  const lastOpenedAt = local?.lastOpenedAt ?? remote.lastOpenedAt

  if (live && !local) {
    const twin = (await songs.index('hash').getAll(remote.hash)).find(
      (song) => song.id !== remote.id && song.deletedAt === null,
    )
    if (twin && twin.id < remote.id) {
      // This device's copy stays, on the lists either copy was on; the other device will drop its own.
      const lists = mergeLists(twin, remote)
      if (!sameLists(lists, twin.lists)) {
        await songs.put({ ...twin, lists, updatedAt: Math.max(now, twin.updatedAt + 1) })
        await markSong(outbox, twin.id)
      }
      await songs.put({
        ...remote,
        lastOpenedAt,
        deletedAt: now,
        updatedAt: Math.max(now, remote.updatedAt + 1),
        mergedInto: twin.id,
      })
      await markSong(outbox, remote.id)
      await tx.done
      return true
    }
    if (twin) {
      await songs.put({
        ...twin,
        deletedAt: now,
        updatedAt: Math.max(now, twin.updatedAt + 1),
        mergedInto: remote.id,
      })
      await markSong(outbox, twin.id)
      await files.delete(twin.id)
      await files.delete(originalKey(twin.id))
      await moveTakes(takes, outbox, twin.id, remote.id)
      const lists = mergeLists(remote, twin)
      const changedLists = !sameLists(lists, remote.lists)
      await songs.put({
        ...remote,
        lists,
        lastOpenedAt: Math.max(lastOpenedAt, twin.lastOpenedAt),
        // The lists this copy brings are news to the other device.
        updatedAt: changedLists ? Math.max(now, remote.updatedAt + 1) : remote.updatedAt,
      })
      if (changedLists) await markSong(outbox, remote.id)
      if (data) await files.put(data, remote.id)
      await tx.done
      return true
    }
  }

  await songs.put({ ...remote, lastOpenedAt })
  if (live) {
    if (data) await files.put(data, remote.id)
  } else {
    await files.delete(remote.id)
    await files.delete(originalKey(remote.id))
    if (remote.mergedInto) {
      await moveTakes(takes, outbox, remote.id, remote.mergedInto)
    } else {
      for (const take of await takes.index('songId').getAll(remote.id)) {
        await takes.delete(take.id)
        await markTake(outbox, take)
      }
    }
  }
  await tx.done
  return true
}

export type TakeResult = 'changed' | 'unchanged' | 'no-song'

/**
 * Takes in a practice take from another device, or its removal. A take for
 * a song not here yet is left for the next run ('no-song').
 */
export async function applyRemoteTake(id: string, songId: string, take: TakeRecord | null): Promise<TakeResult> {
  const tx = (await db()).transaction(['songs', 'takes', 'outbox'], 'readwrite')
  const takes = tx.objectStore('takes')
  const outbox = tx.objectStore('outbox')
  let result: TakeResult = 'unchanged'
  if (!take) {
    if (await takes.get(id)) {
      await takes.delete(id)
      result = 'changed'
    }
  } else if (!(await takes.get(id)) && !(await outbox.get(`take:${id}`))) {
    const song = await tx.objectStore('songs').get(songId)
    if (!song) result = 'no-song'
    else if (song.deletedAt === null) {
      await takes.put({ ...take, id, songId })
      result = 'changed'
    } else if (song.mergedInto) {
      await moveTake(takes, outbox, { ...take, id, songId }, song.mergedInto)
      result = 'changed'
    }
  }
  await tx.done
  return result
}
