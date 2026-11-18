import type { SupabaseClient } from '@supabase/supabase-js'
import type { Cursor, Remote, RemoteSongRow, RemoteTakeRow } from './engine'

const BUCKET = 'tabs'

/** PostgREST filter values in quotes, so dots, commas and colons in them are read as text. */
const quoted = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

function after(cursor: Cursor | null): string | null {
  if (!cursor) return null
  const time = quoted(cursor.modified)
  return `modified.gt.${time},and(modified.eq.${time},id.gt.${quoted(cursor.id)})`
}

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

/** The tables and bucket made by supabase/schema.sql, for the signed-in user. */
export function supabaseRemote(client: SupabaseClient, userId: string): Remote {
  const files = client.storage.from(BUCKET)
  const path = (hash: string) => `${userId}/${hash}`

  return {
    userId,
    async pullSongs(cursor, limit) {
      let query = client.from('songs').select('id, updated_at, record, modified').eq('user_id', userId)
      const filter = after(cursor)
      if (filter) query = query.or(filter)
      const { data, error } = await query.order('modified').order('id').limit(limit)
      fail(error)
      return (data ?? []).map(
        (row): RemoteSongRow => ({ id: row.id, updatedAt: Number(row.updated_at), record: row.record, modified: row.modified }),
      )
    },
    async pullTakes(cursor, limit) {
      let query = client.from('takes').select('id, song_id, record, modified').eq('user_id', userId)
      const filter = after(cursor)
      if (filter) query = query.or(filter)
      const { data, error } = await query.order('modified').order('id').limit(limit)
      fail(error)
      return (data ?? []).map(
        (row): RemoteTakeRow => ({ id: row.id, songId: row.song_id, record: row.record, modified: row.modified }),
      )
    },
    async pushSongs(rows) {
      fail((await client.rpc('push_songs', { rows })).error)
    },
    async pushTakes(rows) {
      fail((await client.rpc('push_takes', { rows })).error)
    },
    async upload(hash, data) {
      const { error } = await files.upload(path(hash), new Blob([data]), {
        contentType: 'application/octet-stream',
        upsert: false,
      })
      if (!error) return
      // Files are named by their contents, so one already there is this one.
      const known = error as { status?: number; statusCode?: string; code?: string }
      if (known.status === 409 || known.statusCode === '409' || known.code === 'ResourceAlreadyExists') return
      throw new Error(error.message)
    },
    async download(hash) {
      const { data, error } = await files.download(path(hash))
      if (error || !data) throw new Error(error?.message ?? `Could not download ${hash}`)
      return data.arrayBuffer()
    },
  }
}
