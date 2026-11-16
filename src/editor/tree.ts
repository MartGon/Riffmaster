import * as alphaTab from '@coderline/alphatab'

/**
 * A song in alphaTab's serialized form: nested `Map`s and arrays, keyed by
 * lower-case property names. Edits are undone by putting earlier parts of
 * this tree back, and every change ends with the song being rebuilt from it.
 */
export type ScoreJs = Map<string, unknown>
export type JsMap = Map<string, unknown>
export type Path = (string | number)[]

export function serialize(score: alphaTab.model.Score): ScoreJs {
  return alphaTab.model.JsonConverter.scoreToJsObject(score) as ScoreJs
}

function step(node: unknown, key: string | number): unknown {
  if (node instanceof Map) return node.get(key as string)
  if (Array.isArray(node)) return node[key as number]
  throw new Error(`Cannot follow "${key}" in the song data`)
}

export function getAt(root: ScoreJs, path: Path): unknown {
  return path.reduce<unknown>(step, root)
}

export function setAt(root: ScoreJs, path: Path, value: unknown): void {
  const parent = getAt(root, path.slice(0, -1))
  const key = path[path.length - 1]
  if (parent instanceof Map) parent.set(key as string, value)
  else if (Array.isArray(parent)) parent[key as number] = value
  else throw new Error(`Cannot set "${key}" in the song data`)
}

export function spliceAt(
  root: ScoreJs,
  path: Path,
  index: number,
  remove: number,
  insert: unknown[],
): unknown[] {
  const list = getAt(root, path)
  if (!Array.isArray(list)) throw new Error('Expected a list in the song data')
  return list.splice(index, remove, ...insert)
}

export function list(map: unknown, key: string): JsMap[] {
  const value = (map as JsMap).get(key)
  return Array.isArray(value) ? (value as JsMap[]) : []
}

/**
 * Note properties that point at another note by id. alphaTab writes them for
 * ties, slides, legato and slurs and restores the links from them. After an
 * edit they can point at a note that moved or was deleted, so they are all
 * dropped and alphaTab works ties, slides and legato out again from the
 * notes themselves.
 */
const NOTE_LINKS = [
  'tiedestinationnoteid',
  'tieoriginnoteid',
  'slurdestinationnoteid',
  'sluroriginnoteid',
  'hammerpulloriginnoteid',
  'hammerpulldestinationnoteid',
  'slidetargetnoteid',
  'slideoriginnoteid',
]

/**
 * Prepares serialized song data for rebuilding. Ids are removed so every
 * rebuilt bar, beat and note gets a fresh, unique one (alphaTab finds beats
 * on screen by id, and pasted or restored parts would otherwise repeat ids).
 * Links between notes are removed as described above. Slurs exist only in
 * MusicXML and alphaTex files and cannot be worked out again, so they are
 * dropped.
 */
export function sanitize(js: ScoreJs): void {
  for (const track of list(js, 'tracks')) {
    for (const staff of list(track, 'staves')) {
      for (const bar of list(staff, 'bars')) {
        bar.delete('id')
        for (const voice of list(bar, 'voices')) {
          voice.delete('id')
          for (const beat of list(voice, 'beats')) {
            beat.delete('id')
            for (const note of list(beat, 'notes')) {
              note.delete('id')
              for (const key of NOTE_LINKS) note.delete(key)
              note.set('isslurdestination', false)
            }
          }
        }
      }
    }
  }
}

/** Builds a finished alphaTab song from serialized data, consuming the data. */
export function rebuild(js: ScoreJs, settings: alphaTab.Settings): alphaTab.model.Score {
  sanitize(js)
  return alphaTab.model.JsonConverter.jsObjectToScore(js, settings)
}

/** A copy of serialized data that shares nothing with the original. */
export function deepCopy<T>(value: T): T {
  if (value instanceof Map) {
    return new Map([...value].map(([key, item]) => [key, deepCopy(item)])) as T
  }
  if (Array.isArray(value)) return value.map(deepCopy) as T
  if (ArrayBuffer.isView(value)) return (value as unknown as Uint8Array).slice() as T
  return value
}
