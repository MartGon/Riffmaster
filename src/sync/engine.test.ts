import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addSong,
  addTake,
  clearTakes,
  deleteSong,
  listSongs,
  listTakes,
  openSong,
  resetConnection,
  saveEditedSong,
  saveSongSettings,
} from '../library/db'
import type { Song, TakeRecord } from '../library/types'
import { type Cursor, type Remote, syncOnce } from './engine'

function file(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

const text = (data: ArrayBuffer) => new TextDecoder().decode(data)

const song = (title: string, contents = title) => ({
  title,
  artist: 'Someone',
  fileName: `${title}.gp`,
  data: file(contents),
})

const take = (songId: string, trackIndex = 0): Omit<TakeRecord, 'id'> => ({
  songId,
  at: Date.now(),
  trackIndex,
  speed: 1,
  startBar: 0,
  endBar: 3,
  scored: 10,
  onTime: 8,
  early: 1,
  late: 0,
  missed: 1,
  accuracy: 0.9,
  bars: {},
  trainer: false,
})

/** The server, following the rules in supabase/schema.sql. */
class FakeServer {
  songs = new Map<string, { id: string; updatedAt: number; record: Song; modified: string }>()
  takes = new Map<string, { id: string; songId: string; record: TakeRecord | null; modified: string }>()
  files = new Map<string, ArrayBuffer>()
  uploads = 0
  private clock = Date.parse('2026-01-01T00:00:00Z')
  offline = false

  private now() {
    this.clock += 1
    return new Date(this.clock).toISOString()
  }

  private check() {
    if (this.offline) throw new TypeError('Failed to fetch')
  }

  remote(userId = 'user-1'): Remote {
    const page = <T extends { id: string; modified: string }>(rows: T[], after: Cursor | null, limit: number) =>
      rows
        .filter((row) => !after || row.modified > after.modified || (row.modified === after.modified && row.id > after.id))
        .sort((a, b) => (a.modified === b.modified ? (a.id < b.id ? -1 : 1) : a.modified < b.modified ? -1 : 1))
        .slice(0, limit)
        .map((row) => structuredClone(row))
    return {
      userId,
      pullSongs: async (after, limit) => {
        this.check()
        return page([...this.songs.values()], after, limit)
      },
      pullTakes: async (after, limit) => {
        this.check()
        return page([...this.takes.values()], after, limit)
      },
      pushSongs: async (rows) => {
        this.check()
        for (const row of rows) {
          const known = this.songs.get(row.id)
          if (known && known.updatedAt >= row.updatedAt) continue
          this.songs.set(row.id, { ...structuredClone(row), modified: this.now() })
        }
      },
      pushTakes: async (rows) => {
        this.check()
        for (const row of rows) {
          const known = this.takes.get(row.id)
          if (known && (known.record === null || row.record !== null)) continue
          this.takes.set(row.id, { ...structuredClone(row), modified: this.now() })
        }
      },
      upload: async (hash, data) => {
        this.check()
        this.uploads++
        if (!this.files.has(hash)) this.files.set(hash, data.slice(0))
      },
      download: async (hash) => {
        this.check()
        const data = this.files.get(hash)
        if (!data) throw new Error(`No file ${hash}`)
        return data.slice(0)
      },
    }
  }
}

/** Two browsers, each with its own library. */
const devices = { a: new IDBFactory(), b: new IDBFactory() }
async function on(device: keyof typeof devices) {
  await resetConnection()
  globalThis.indexedDB = devices[device]
}

let server: FakeServer

beforeEach(async () => {
  devices.a = new IDBFactory()
  devices.b = new IDBFactory()
  server = new FakeServer()
  await on('a')
})

describe('sync', () => {
  it('copies songs, their files and takes to another device', async () => {
    const added = await addSong(song('Song A', 'tab A'))
    await addTake(take(added.id))
    const first = await syncOnce(server.remote())
    expect(first.sent).toBe(2)

    await on('b')
    const result = await syncOnce(server.remote())
    expect(result.changed).toBe(true)
    const list = await listSongs()
    expect(list.map((s) => s.title)).toEqual(['Song A'])
    const opened = await openSong(list[0].id)
    expect(text(opened!.data)).toBe('tab A')
    expect(await listTakes(added.id)).toHaveLength(1)
  })

  it('sends nothing again once everything is sent', async () => {
    await addSong(song('Song A'))
    await syncOnce(server.remote())
    const again = await syncOnce(server.remote())
    expect(again).toEqual({ changed: false, sent: 0, received: 0 })
    expect(server.uploads).toBe(1)
  })

  it('keeps the newer settings of a song changed on both devices', async () => {
    const added = await addSong(song('Song A'), 1000)
    await syncOnce(server.remote())
    await on('b')
    await syncOnce(server.remote())

    await saveSongSettings(added.id, { ...added.settings, speed: 0.5 }, 3000)
    await syncOnce(server.remote())
    await on('a')
    await saveSongSettings(added.id, { ...added.settings, speed: 0.75 }, 2000)
    await syncOnce(server.remote())
    expect((await listSongs())[0].settings.speed).toBe(0.5)
    await on('b')
    await syncOnce(server.remote())
    expect((await listSongs())[0].settings.speed).toBe(0.5)
  })

  it('removes a deleted song and its takes on the other device', async () => {
    const added = await addSong(song('Song A'))
    await addTake(take(added.id))
    await syncOnce(server.remote())
    await on('b')
    await syncOnce(server.remote())

    await on('a')
    await deleteSong(added.id)
    await syncOnce(server.remote())
    await on('b')
    await syncOnce(server.remote())
    expect(await listSongs()).toEqual([])
    expect(await listTakes(added.id)).toEqual([])
    expect(await openSong(added.id)).toBeNull()
  })

  it('sends an edited file and its new contents arrive', async () => {
    const added = await addSong(song('Song A', 'first'))
    await syncOnce(server.remote())
    await on('b')
    await syncOnce(server.remote())

    await saveEditedSong(added.id, file('second'), { title: 'Song A (edit)', artist: 'Someone' })
    await syncOnce(server.remote())
    await on('a')
    await syncOnce(server.remote())
    const opened = await openSong(added.id)
    expect(opened!.song.title).toBe('Song A (edit)')
    expect(text(opened!.data)).toBe('second')
  })

  it('keeps removed takes removed', async () => {
    const added = await addSong(song('Song A'))
    await addTake(take(added.id, 0))
    await addTake(take(added.id, 1))
    await syncOnce(server.remote())
    await on('b')
    await syncOnce(server.remote())
    await clearTakes(added.id, 0)
    await syncOnce(server.remote())

    await on('a')
    await syncOnce(server.remote())
    expect((await listTakes(added.id)).map((t) => t.trackIndex)).toEqual([1])
    // A device that has never synced does not bring the removed take back either.
    devices.b = new IDBFactory()
    await on('b')
    await syncOnce(server.remote())
    expect((await listTakes(added.id)).map((t) => t.trackIndex)).toEqual([1])
  })

  it('makes one song of the same file added on both devices, with both histories', async () => {
    const onA = await addSong(song('Song A', 'same file'))
    await addTake(take(onA.id, 0))
    await on('b')
    const onB = await addSong(song('Song A', 'same file'))
    await addTake(take(onB.id, 1))

    await on('a')
    await syncOnce(server.remote())
    await on('b')
    await syncOnce(server.remote())
    await on('a')
    await syncOnce(server.remote())
    await on('b')
    await syncOnce(server.remote())

    const kept = onA.id < onB.id ? onA.id : onB.id
    for (const device of ['a', 'b'] as const) {
      await on(device)
      const list = await listSongs()
      expect(list.map((s) => s.id), device).toEqual([kept])
      expect((await listTakes(kept)).map((t) => t.trackIndex).sort(), device).toEqual([0, 1])
    }
  })

  it('leaves the library as it was while offline, and catches up after', async () => {
    await addSong(song('Song A'))
    server.offline = true
    await expect(syncOnce(server.remote())).rejects.toThrow('Failed to fetch')
    expect(await listSongs()).toHaveLength(1)
    server.offline = false
    expect((await syncOnce(server.remote())).sent).toBe(1)
  })

  it('sends a whole library again after a different account signs in', async () => {
    await addSong(song('Song A'))
    await syncOnce(server.remote('user-1'))
    const other = new FakeServer()
    expect((await syncOnce(other.remote('user-2'))).sent).toBe(1)
  })

  it('sends a library saved before sync existed', async () => {
    // The library as the previous version of the app left it.
    const old = await openDB('riffmaster', 2, {
      upgrade(database) {
        database.createObjectStore('songs', { keyPath: 'id' }).createIndex('hash', 'hash')
        database.createObjectStore('files')
        database.createObjectStore('takes', { keyPath: 'id' }).createIndex('songId', 'songId')
      },
    })
    const { id, ...rest } = await (async () => {
      await on('b')
      const made = await addSong(song('Old song', 'old tab'))
      await on('a')
      return made
    })()
    await old.put('songs', { id, ...rest })
    await old.put('files', file('old tab'), id)
    await old.put('takes', { ...take(id), id: 'take-1' })
    old.close()

    expect((await syncOnce(server.remote())).sent).toBe(2)
    expect(text(server.files.get(rest.hash)!)).toBe('old tab')
  })

  it('reads in pages', async () => {
    for (let i = 0; i < 520; i++) await addSong(song(`Song ${i}`))
    await syncOnce(server.remote())
    await on('b')
    await syncOnce(server.remote())
    expect(await listSongs()).toHaveLength(520)
  }, 60000)
})
