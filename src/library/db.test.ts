import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addSong,
  addTake,
  clearTakes,
  deleteSong,
  listSongs,
  listTakes,
  openSong,
  hasOriginal,
  resetConnection,
  restoreOriginal,
  saveEditedSong,
  saveSongSettings,
} from './db'
import type { TakeRecord } from './types'

function file(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

const song = (title: string, text = title) => ({
  title,
  artist: 'Someone',
  fileName: `${title}.gp`,
  data: file(text),
})

beforeEach(async () => {
  await resetConnection()
  globalThis.indexedDB = new IDBFactory()
})

describe('song library', () => {
  it('lists songs with the most recently opened first', async () => {
    const a = await addSong(song('A'), 1000)
    await addSong(song('B'), 2000)
    expect((await listSongs()).map((s) => s.title)).toEqual(['B', 'A'])
    await openSong(a.id, 3000)
    expect((await listSongs()).map((s) => s.title)).toEqual(['A', 'B'])
  })

  it('returns the stored file when a song is opened', async () => {
    const added = await addSong(song('A', 'file-bytes'), 1000)
    const opened = await openSong(added.id, 2000)
    expect(new TextDecoder().decode(opened?.data)).toBe('file-bytes')
    expect(opened?.song.lastOpenedAt).toBe(2000)
    expect(opened?.song.updatedAt).toBe(1000)
  })

  it('does not duplicate a file that is already in the library', async () => {
    const first = await addSong(song('A', 'same'), 1000)
    const second = await addSong({ ...song('Renamed', 'same') }, 2000)
    expect(second.id).toBe(first.id)
    expect(second.title).toBe('A')
    expect(await listSongs()).toHaveLength(1)
  })

  it('keeps settings per song', async () => {
    const added = await addSong(song('A'), 1000)
    const settings = { speed: 0.6, trackIndex: 4, mutedTracks: [0], soloTracks: [] }
    await saveSongSettings(added.id, settings, 2000)
    const opened = await openSong(added.id, 3000)
    expect(opened?.song.settings).toEqual(settings)
    expect(opened?.song.updatedAt).toBe(2000)
  })

  it('hides a deleted song and drops its file', async () => {
    const added = await addSong(song('A'), 1000)
    await deleteSong(added.id, 2000)
    expect(await listSongs()).toEqual([])
    expect(await openSong(added.id)).toBeNull()
  })

  it('restores a deleted song when the same file is added again', async () => {
    const added = await addSong(song('A', 'same'), 1000)
    await saveSongSettings(added.id, { speed: 0.5, trackIndex: 1, mutedTracks: [], soloTracks: [] })
    await deleteSong(added.id, 2000)
    const again = await addSong(song('A', 'same'), 3000)
    expect(again.id).toBe(added.id)
    expect(again.settings.speed).toBe(0.5)
    expect(await openSong(added.id)).not.toBeNull()
  })
})

const take = (songId: string, at: number, change: Partial<TakeRecord> = {}): Omit<TakeRecord, 'id'> => ({
  songId,
  at,
  trackIndex: 4,
  speed: 1,
  startBar: 0,
  endBar: 7,
  scored: 10,
  onTime: 7,
  early: 1,
  late: 0,
  missed: 2,
  accuracy: 0.8,
  bars: { 2: { scored: 4, missed: 2, offTime: 1 } },
  trainer: false,
  ...change,
})

describe('practice history', () => {
  it('lists a song\'s takes oldest first', async () => {
    const a = await addSong(song('A'), 1000)
    const b = await addSong(song('B'), 1000)
    await addTake(take(a.id, 3000))
    await addTake(take(a.id, 2000, { accuracy: 0.5 }))
    await addTake(take(b.id, 2500))
    const takes = await listTakes(a.id)
    expect(takes.map((t) => t.at)).toEqual([2000, 3000])
    expect(takes[0].bars[2]).toEqual({ scored: 4, missed: 2, offTime: 1 })
  })

  it('clears one track and keeps the others', async () => {
    const a = await addSong(song('A'), 1000)
    await addTake(take(a.id, 2000))
    await addTake(take(a.id, 3000, { trackIndex: 5 }))
    await clearTakes(a.id, 4)
    expect((await listTakes(a.id)).map((t) => t.trackIndex)).toEqual([5])
  })

  it('drops the history with the song', async () => {
    const a = await addSong(song('A'), 1000)
    await addTake(take(a.id, 2000))
    await deleteSong(a.id, 3000)
    expect(await listTakes(a.id)).toEqual([])
  })

  it('keeps songs when an older library is upgraded', async () => {
    // A library made before practice history existed has no takes store.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('riffmaster', 1)
      request.onupgradeneeded = () => {
        const songs = request.result.createObjectStore('songs', { keyPath: 'id' })
        songs.createIndex('hash', 'hash')
        request.result.createObjectStore('files')
      }
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
    const a = await addSong(song('A'), 1000)
    await addTake(take(a.id, 2000))
    expect(await listSongs()).toHaveLength(1)
    expect(await listTakes(a.id)).toHaveLength(1)
  })
})

describe('edited songs', () => {
  const text = (data: ArrayBuffer) => new TextDecoder().decode(data)

  it('saves an edit and keeps the first original for restoring', async () => {
    const added = await addSong(song('A', 'original'), 1000)
    expect(await hasOriginal(added.id)).toBe(false)
    const saved = await saveEditedSong(added.id, file('edit one'), { title: 'A2', artist: 'Me' }, 2000)
    expect(saved).toMatchObject({ title: 'A2', artist: 'Me', size: 8, updatedAt: 2000 })
    await saveEditedSong(added.id, file('edit two'), { title: 'A3', artist: 'Me' }, 3000)
    expect(text((await openSong(added.id))!.data)).toBe('edit two')
    expect(await hasOriginal(added.id)).toBe(true)

    const restored = await restoreOriginal(added.id, () => ({ title: 'A', artist: 'Someone' }), 4000)
    expect(text(restored!)).toBe('original')
    const reopened = await openSong(added.id)
    expect(text(reopened!.data)).toBe('original')
    expect(reopened!.song.title).toBe('A')
    expect(await hasOriginal(added.id)).toBe(false)
    expect(await restoreOriginal(added.id, () => ({ title: 'A', artist: '' }))).toBeNull()
  })

  it('recognises the edited file as already in the library', async () => {
    const added = await addSong(song('A', 'original'))
    await saveEditedSong(added.id, file('edited'), { title: 'A', artist: '' })
    const again = await addSong(song('A copy', 'edited'))
    expect(again.id).toBe(added.id)
  })

  it('does not save into a removed song, and removes the original with the song', async () => {
    const added = await addSong(song('A', 'original'))
    await saveEditedSong(added.id, file('edited'), { title: 'A', artist: '' })
    await deleteSong(added.id)
    expect(await hasOriginal(added.id)).toBe(false)
    expect(await saveEditedSong(added.id, file('again'), { title: 'A', artist: '' })).toBeNull()
  })
})
