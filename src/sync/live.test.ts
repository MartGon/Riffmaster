// Sync against the real Supabase project, as two devices. Skipped unless asked for:
// RIFF_LIVE_EMAIL=<file> RIFF_LIVE_PASSWORD=<file> npx vitest run src/sync/live.test.ts
// Both variables name files holding the value, so the password never appears in a command.
// It leaves a deleted "Sync self-test" song, a removed take and a small file in the project.
import 'fake-indexeddb/auto'
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { addSong, addTake, deleteSong, listSongs, listTakes, openSong, resetConnection, saveSongSettings } from '../library/db'
import { syncOnce } from './engine'
import { supabaseRemote } from './supabaseRemote'

const emailFile = process.env.RIFF_LIVE_EMAIL
const passwordFile = process.env.RIFF_LIVE_PASSWORD

function env(name: string): string {
  const line = fs
    .readFileSync('.env.local', 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith(`${name}=`))
  return line?.slice(name.length + 1).trim() ?? ''
}

const devices = { a: new IDBFactory(), b: new IDBFactory() }
async function on(device: keyof typeof devices) {
  await resetConnection()
  globalThis.indexedDB = devices[device]
}

describe.skipIf(!emailFile || !passwordFile)('sync with the real project', () => {
  it('carries a song, its file, settings, a take and a deletion between two devices', async () => {
    const client = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await client.auth.signInWithPassword({
      email: fs.readFileSync(emailFile!, 'utf8').trim(),
      password: fs.readFileSync(passwordFile!, 'utf8').trim(),
    })
    expect(error?.message ?? null).toBeNull()
    const remote = supabaseRemote(client, data.user!.id)

    await on('a')
    const contents = `sync self-test ${Date.now()}`
    const song = await addSong({
      title: 'Sync self-test',
      artist: 'RiffMaster',
      fileName: 'self-test.gp',
      data: new TextEncoder().encode(contents).buffer as ArrayBuffer,
    })
    await addTake({
      songId: song.id, at: Date.now(), trackIndex: 0, speed: 1, startBar: 0, endBar: 1,
      scored: 4, onTime: 4, early: 0, late: 0, missed: 0, accuracy: 1, bars: {}, trainer: false,
    })
    expect((await syncOnce(remote)).sent).toBeGreaterThanOrEqual(2)
    // Sending again uploads nothing new.
    expect((await syncOnce(remote)).sent).toBe(0)

    await on('b')
    await syncOnce(remote)
    const opened = await openSong(song.id)
    expect(new TextDecoder().decode(opened!.data)).toBe(contents)
    expect(await listTakes(song.id)).toHaveLength(1)
    await saveSongSettings(song.id, { ...song.settings, speed: 0.6 })
    await syncOnce(remote)

    await on('a')
    await syncOnce(remote)
    expect((await listSongs()).find((s) => s.id === song.id)?.settings.speed).toBe(0.6)
    await deleteSong(song.id)
    await syncOnce(remote)

    await on('b')
    await syncOnce(remote)
    expect((await listSongs()).some((s) => s.id === song.id)).toBe(false)
    expect(await listTakes(song.id)).toEqual([])

    // What the server holds now: the song marked deleted, the take removed.
    const row = await client.from('songs').select('record').eq('id', song.id).single()
    expect(row.data?.record.deletedAt).not.toBeNull()
    const takeRows = await client.from('takes').select('record').eq('song_id', song.id)
    expect(takeRows.data?.every((take) => take.record === null)).toBe(true)
    await client.auth.signOut()
  }, 60000)
})
