import { describe, expect, it } from 'vitest'
import { addToList, allLists, cleanListName, deleteList, listsOf, mergeLists, moveInList, removeFromList, renameList, sameLists, songsInList, type ListChanges } from './lists'
import { defaultSongSettings, type Song } from './types'

const song = (id: string, lists?: Record<string, number>, title = id): Song => ({
  id,
  title,
  artist: '',
  fileName: `${id}.gp`,
  size: 1,
  hash: id,
  addedAt: 0,
  updatedAt: 0,
  lastOpenedAt: 0,
  deletedAt: null,
  settings: { ...defaultSongSettings },
  lists,
})
/** The songs with their changes made. */
const apply = (songs: Song[], changes: ListChanges) => songs.map((item) => (changes.has(item.id) ? { ...item, lists: changes.get(item.id) } : item))
const order = (songs: Song[], name: string) => songsInList(songs, name).map((item) => item.id)

describe('song lists', () => {
  it('cleans up names', () => {
    expect(cleanListName('  Gig   set ')).toBe('Gig set')
    expect(cleanListName('   ')).toBeNull()
    expect(cleanListName('x'.repeat(60))).toHaveLength(40)
  })

  it('lists the lists, with their sizes', () => {
    const songs = [song('a', { 'Gig set': 0, Warmup: 0 }), song('b', { 'Gig set': 1 }), song('c')]
    expect(allLists(songs)).toEqual([
      { name: 'Gig set', count: 2 },
      { name: 'Warmup', count: 1 },
    ])
  })

  it('adds songs at the end and keeps the order', () => {
    let songs = [song('a'), song('b'), song('c')]
    for (const id of ['c', 'a', 'b']) songs = apply(songs, addToList(songs, id, 'Gig'))
    expect(order(songs, 'Gig')).toEqual(['c', 'a', 'b'])
    expect(addToList(songs, 'a', 'Gig').size).toBe(0)
  })

  it('moves a song up and down, and pulls apart places two devices gave alike', () => {
    let songs = [song('a', { Gig: 0 }, 'A'), song('b', { Gig: 0 }, 'B'), song('c', { Gig: 1 }, 'C')]
    expect(order(songs, 'Gig')).toEqual(['a', 'b', 'c'])
    songs = apply(songs, moveInList(songs, 'Gig', 'c', -1))
    expect(order(songs, 'Gig')).toEqual(['a', 'c', 'b'])
    expect(songs.map((item) => item.lists?.Gig)).toEqual([0, 2, 1])
    expect(moveInList(songs, 'Gig', 'a', -1).size).toBe(0)
  })

  it('removes a song, leaving its other lists', () => {
    const songs = [song('a', { Gig: 0, Warmup: 3 }), song('b', { Gig: 1 })]
    expect(removeFromList(songs, 'a', 'Gig').get('a')).toEqual({ Warmup: 3 })
    expect(removeFromList(songs, 'b', 'Gig').get('b')).toBeUndefined()
    expect(removeFromList(songs, 'b', 'Gig').has('b')).toBe(true)
  })

  it('renames a list, joining another of that name at its end', () => {
    const songs = [song('a', { Old: 0 }), song('b', { Old: 1, New: 0 }), song('c', { New: 0 })]
    const renamed = apply(songs, renameList(songs, 'Old', 'New'))
    expect(allLists(renamed)).toEqual([{ name: 'New', count: 3 }])
    expect(order(renamed, 'New')[2]).toBe('a')
  })

  it('deletes a list from every song on it', () => {
    const songs = [song('a', { Gig: 0, Warmup: 0 }), song('b', { Gig: 1 })]
    expect(allLists(apply(songs, deleteList(songs, 'Gig')))).toEqual([{ name: 'Warmup', count: 1 }])
  })

  it('ignores damaged lists from storage', () => {
    expect(listsOf(song('a', { Gig: 'x' as unknown as number, ' bad ': 1, Fine: 2 }))).toEqual({ Fine: 2 })
    expect(listsOf({ ...song('a'), lists: 'x' as unknown as Record<string, number> })).toEqual({})
  })

  it('takes any name, even one an object already has', () => {
    let songs = [song('a'), song('b', { Gig: 0 })]
    for (const name of ['constructor', 'toString', '__proto__']) {
      songs = apply(songs, addToList(songs, 'a', name))
      expect(order(songs, name), name).toEqual(['a'])
    }
    expect(order(songs, 'valueOf')).toEqual([])
    const renamed = apply(songs, renameList(songs, 'Gig', 'hasOwnProperty'))
    expect(order(renamed, 'hasOwnProperty')).toEqual(['b'])
  })

  it('compares lists whatever order their names are in', () => {
    expect(sameLists({ A: 1, B: 2 }, { B: 2, A: 1 })).toBe(true)
    expect(sameLists({ A: 1 }, { A: 2 })).toBe(false)
    expect(sameLists(undefined, {})).toBe(true)
    expect(sameLists({ A: 1 }, undefined)).toBe(false)
  })

  it('merges the lists of a song added on two devices', () => {
    expect(mergeLists(song('a', { Gig: 2 }), song('b', { Gig: 5, Warmup: 0 }))).toEqual({ Gig: 2, Warmup: 0 })
    // Nothing new: the kept copy's lists come back as they were, in their order.
    expect(Object.keys(mergeLists(song('a', { A: 1, B: 2 }), song('b', { B: 0 }))!)).toEqual(['A', 'B'])
    expect(mergeLists(song('a'), song('b'))).toBeUndefined()
  })
})
