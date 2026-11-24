import type { Song } from './types'

/**
 * Lists of songs, such as "Working on" or "Gig set", each in its own order.
 * A list lives in the records of its songs, as the song's place in it, so
 * it syncs with them and needs no storage of its own. A list with no songs
 * left is gone.
 */

export const MAX_LIST_NAME = 40

/** A list name as kept: trimmed, single spaces, not too long; null when nothing is left. */
export function cleanListName(name: string): string | null {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_LIST_NAME).trim()
  return clean.length > 0 ? clean : null
}

/** The lists a song is on, with its place in each; anything damaged is left out. */
export function listsOf(song: Song): Record<string, number> {
  // With no prototype, a list called "constructor" or "__proto__" is a list like any other.
  const out: Record<string, number> = Object.create(null) as Record<string, number>
  const lists = song.lists
  if (!lists || typeof lists !== 'object') return out
  for (const [name, place] of Object.entries(lists)) {
    if (cleanListName(name) === name && typeof place === 'number' && Number.isFinite(place)) out[name] = place
  }
  return out
}

/** Every list in the library, by name, with how many songs are on it. */
export function allLists(songs: Song[]): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const song of songs) for (const name of Object.keys(listsOf(song))) counts.set(name, (counts.get(name) ?? 0) + 1)
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name))
}

/** The songs on a list, in its order. Two devices can give songs the same place; the title then decides. */
export function songsInList(songs: Song[], name: string): Song[] {
  return songs
    .filter((song) => Object.hasOwn(listsOf(song), name))
    .sort((a, b) => listsOf(a)[name] - listsOf(b)[name] || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}

/** New lists for the songs that change; `undefined` for a song left on no list. */
export type ListChanges = Map<string, Record<string, number> | undefined>

/** A song's lists as stored: a plain object, or nothing when it is on none. */
const stored = (lists: Record<string, number>): Record<string, number> | undefined =>
  Object.keys(lists).length > 0 ? { ...lists } : undefined

const withList = (song: Song, name: string, place: number | null): Record<string, number> | undefined => {
  const lists = listsOf(song)
  if (place === null) delete lists[name]
  else lists[name] = place
  return stored(lists)
}

/** Puts a song on a list, at its end. */
export function addToList(songs: Song[], songId: string, name: string): ListChanges {
  const changes: ListChanges = new Map()
  const song = songs.find((item) => item.id === songId)
  if (!song || Object.hasOwn(listsOf(song), name)) return changes
  const places = songsInList(songs, name).map((item) => listsOf(item)[name])
  changes.set(songId, withList(song, name, places.length > 0 ? Math.max(...places) + 1 : 0))
  return changes
}

export function removeFromList(songs: Song[], songId: string, name: string): ListChanges {
  const changes: ListChanges = new Map()
  const song = songs.find((item) => item.id === songId)
  if (song && Object.hasOwn(listsOf(song), name)) changes.set(songId, withList(song, name, null))
  return changes
}

/** Moves a song up (−1) or down (+1) its list. Every song gets a clean place, so places that collided come apart. */
export function moveInList(songs: Song[], name: string, songId: string, step: -1 | 1): ListChanges {
  const order = songsInList(songs, name)
  const from = order.findIndex((song) => song.id === songId)
  const to = from + step
  const changes: ListChanges = new Map()
  if (from < 0 || to < 0 || to >= order.length) return changes
  ;[order[from], order[to]] = [order[to], order[from]]
  order.forEach((song, place) => {
    if (listsOf(song)[name] !== place) changes.set(song.id, withList(song, name, place))
  })
  return changes
}

/** Renames a list. Renamed onto another list, its songs join that one at the end, in their order. */
export function renameList(songs: Song[], from: string, to: string): ListChanges {
  const changes: ListChanges = new Map()
  if (from === to) return changes
  const moving = songsInList(songs, from)
  const staying = songsInList(songs, to)
  let next = staying.length > 0 ? Math.max(...staying.map((song) => listsOf(song)[to])) + 1 : 0
  for (const song of moving) {
    const lists = listsOf(song)
    delete lists[from]
    if (!Object.hasOwn(lists, to)) lists[to] = next++
    changes.set(song.id, stored(lists))
  }
  return changes
}

export function deleteList(songs: Song[], name: string): ListChanges {
  const changes: ListChanges = new Map()
  for (const song of songsInList(songs, name)) changes.set(song.id, withList(song, name, null))
  return changes
}

/** The lists of two records of one song, as when two devices added the same file: on every list either was on. */
export function mergeLists(kept: Song, other: Song): Record<string, number> | undefined {
  // The kept copy's places first, so a merge that adds nothing changes nothing.
  const lists = listsOf(kept)
  for (const [name, place] of Object.entries(listsOf(other))) if (!Object.hasOwn(lists, name)) lists[name] = place
  return stored(lists)
}

/** Whether two songs' lists are the same, whatever order their names were written in. */
export function sameLists(a: Record<string, number> | undefined, b: Record<string, number> | undefined): boolean {
  const x = Object.entries(a ?? {})
  const y = b ?? {}
  return x.length === Object.keys(y).length && x.every(([name, place]) => Object.hasOwn(y, name) && y[name] === place)
}
