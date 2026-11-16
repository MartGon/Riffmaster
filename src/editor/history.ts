import type * as alphaTab from '@coderline/alphatab'
import { getAt, list, type Path, rebuild, type ScoreJs, serialize, setAt, spliceAt } from './tree'

/** Where the editor's cursor is: a string of one beat of the first voice. */
export interface Cursor {
  track: number
  bar: number
  /** Index of the beat in the bar's first voice. */
  beat: number
  /** String number as alphaTab counts them: 1 is the lowest-sounding string. */
  string: number
}

/**
 * Which parts of the song an edit may change. Undoing puts back exactly
 * these parts, so an edit must list everything it touches.
 */
export type Touch =
  /** The contents of one bar of a track (its first staff). */
  | { kind: 'bar'; track: number; bar: number }
  /** Time signature, repeats, section and tempo of one bar, for all tracks. */
  | { kind: 'masterBar'; bar: number }
  | { kind: 'songInfo' }
  /** Name, tuning, capo and sound of a track. */
  | { kind: 'trackInfo'; track: number }
  /** Bars added at `at` in every track; the bars exist after the edit. */
  | { kind: 'insertBars'; at: number; count: number }
  /** Bars removed at `at` from every track; the bars exist before the edit. */
  | { kind: 'deleteBars'; at: number; count: number }
  | { kind: 'insertTrack'; at: number }
  | { kind: 'deleteTrack'; at: number }

export interface Edit {
  /** Short description, e.g. for an "Undo …" tooltip. */
  label: string
  touches: Touch[]
  /** Changes the song in place and returns where the cursor goes. */
  apply?: (score: alphaTab.model.Score) => Cursor
  /** Changes the serialized song in place instead, replacing (never mutating) parts of it. */
  applyJs?: (js: ScoreJs) => Cursor
}

type Change =
  | { op: 'set'; path: Path; value: unknown }
  | { op: 'splice'; path: Path; index: number; remove: number; insert: unknown[] }

interface Entry {
  id: number
  label: string
  undo: Change[]
  redo: Change[]
  cursorBefore: Cursor
  cursorAfter: Cursor
  /** First bar the edit changed, so only the rest of the song needs laying out again. */
  firstBar: number | undefined
  touches: Touch[]
  /** Fret typed as the first digit of a two-digit number; the second digit is folded into this entry. */
  mergeKey?: string
}

/** Bars on each side of an inserted or deleted run that are recorded for undo. */
const NEIGHBOURS = 4

const SONG_INFO_KEYS = ['title', 'artist', 'album', 'subtitle']
const TRACK_INFO_KEYS = ['name', 'shortname', 'playbackinfo']
const STAFF_INFO_KEYS = ['stringtuning', 'capo']

/** Every list of bars in the song: the shared bar list and each staff's bars. */
function barLists(js: ScoreJs): Path[] {
  const paths: Path[] = [['masterbars']]
  list(js, 'tracks').forEach((track, t) => {
    list(track, 'staves').forEach((_staff, s) => paths.push(['tracks', t, 'staves', s, 'bars']))
  })
  return paths
}

function barPath(track: number, bar: number): Path {
  return ['tracks', track, 'staves', 0, 'bars', bar]
}

/**
 * The changes that turn the song into the state `js` describes, for the parts
 * an edit touches. `side` says whether `js` is the song before the edit (for
 * undoing) or after it (for redoing).
 */
function capture(js: ScoreJs, touches: Touch[], side: 'before' | 'after'): Change[] {
  const changes: Change[] = []
  const set = (path: Path) => changes.push({ op: 'set', path, value: getAt(js, path) })
  for (const touch of touches) {
    switch (touch.kind) {
      case 'bar':
        set(barPath(touch.track, touch.bar))
        break
      case 'masterBar':
        set(['masterbars', touch.bar])
        break
      case 'songInfo':
        for (const key of SONG_INFO_KEYS) set([key])
        break
      case 'trackInfo':
        for (const key of TRACK_INFO_KEYS) set(['tracks', touch.track, key])
        for (const key of STAFF_INFO_KEYS) set(['tracks', touch.track, 'staves', 0, key])
        break
      case 'insertBars':
      case 'deleteBars': {
        // Undoing an insertion removes bars; redoing it adds the new ones back.
        const present = (touch.kind === 'insertBars') === (side === 'after')
        const splices: Change[] = []
        const neighbours: Change[] = []
        for (const path of barLists(js)) {
          const bars = getAt(js, path) as unknown[]
          splices.push(
            present
              ? { op: 'splice', path, index: touch.at, remove: 0, insert: bars.slice(touch.at, touch.at + touch.count) }
              : { op: 'splice', path, index: touch.at, remove: touch.count, insert: [] },
          )
          // alphaTab rewrites bars near the change when it rebuilds the song:
          // it drops slides and hammer-ons whose next note moved away, and ties
          // whose first note went (up to three bars back). Those bars are
          // recorded too, as they are on this side of the edit.
          const end = Math.min(bars.length, touch.at + (present ? touch.count : 0) + NEIGHBOURS)
          for (let index = Math.max(0, touch.at - NEIGHBOURS); index < end; index++) {
            neighbours.push({ op: 'set', path: [...path, index], value: bars[index] })
          }
        }
        // Undo changes are applied last to first, redo changes first to last:
        // either way the bars are spliced first and the neighbours set after.
        if (side === 'before') changes.push(...neighbours, ...splices)
        else changes.push(...splices, ...neighbours)
        break
      }
      case 'insertTrack':
      case 'deleteTrack': {
        const present = (touch.kind === 'insertTrack') === (side === 'after')
        const tracks = getAt(js, ['tracks']) as unknown[]
        changes.push(
          present
            ? { op: 'splice', path: ['tracks'], index: touch.at, remove: 0, insert: [tracks[touch.at]] }
            : { op: 'splice', path: ['tracks'], index: touch.at, remove: 1, insert: [] },
        )
        break
      }
    }
  }
  return changes
}

/**
 * The first bar an edit can change the look of, or undefined when the whole
 * sheet must be drawn again: song and track details appear in its header,
 * which alphaTab keeps when only later bars change.
 */
function firstChangedBar(touches: Touch[]): number | undefined {
  let first = Number.POSITIVE_INFINITY
  for (const touch of touches) {
    if (touch.kind === 'bar' || touch.kind === 'masterBar') first = Math.min(first, touch.bar)
    else if (touch.kind === 'insertBars' || touch.kind === 'deleteBars') first = Math.min(first, touch.at)
    else return undefined
  }
  return Number.isFinite(first) ? Math.max(0, first - NEIGHBOURS) : undefined
}

/** A track added or removed by an edit, so per-track choices such as mute can follow the tracks. */
export type TrackChange = { kind: 'insert' | 'delete'; at: number } | null

function trackChange(touches: Touch[], undoing: boolean): TrackChange {
  for (const touch of touches) {
    if (touch.kind === 'insertTrack' || touch.kind === 'deleteTrack') {
      const inserted = (touch.kind === 'insertTrack') !== undoing
      return { kind: inserted ? 'insert' : 'delete', at: touch.at }
    }
  }
  return null
}

/** What a change hands back: the rebuilt song, where the cursor goes, and the first bar that changed. */
export interface EditResult {
  score: alphaTab.model.Score
  cursor: Cursor
  firstBar: number | undefined
  tracks: TrackChange
}

function applyChanges(js: ScoreJs, changes: Change[]): void {
  for (const change of changes) {
    if (change.op === 'set') setAt(js, change.path, change.value)
    else spliceAt(js, change.path, change.index, change.remove, change.insert.slice())
  }
}

/** How many steps can be undone. Each keeps only the bars it changed. */
const LIMIT = 200

/**
 * Undo and redo for the editor. Every change goes through `commit`, which
 * records the touched parts before and after, and returns the rebuilt song.
 */
export class EditHistory {
  private undoStack: Entry[] = []
  private redoStack: Entry[] = []
  private nextId = 1
  private savedId = 0
  /** Identifies the song as it is with every remaining step undone. */
  private baseId = 0
  private readonly settings: alphaTab.Settings

  constructor(settings: alphaTab.Settings) {
    this.settings = settings
  }

  /** Identifies the current state of the song, for knowing whether it has been saved. */
  get currentId(): number {
    return this.undoStack[this.undoStack.length - 1]?.id ?? this.baseId
  }
  get dirty(): boolean {
    return this.currentId !== this.savedId
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0
  }
  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null
  }
  get redoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null
  }
  /** Last edit, when it may still take a second digit. */
  get mergeKey(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.mergeKey
  }

  markSaved(): void {
    this.savedId = this.currentId
  }

  /** Forgets all steps, e.g. after another song was loaded. The song counts as saved. */
  reset(): void {
    this.undoStack = []
    this.redoStack = []
    this.savedId = 0
    this.baseId = 0
  }

  /**
   * Applies an edit. The song passed in may be changed in place and must
   * not be used afterwards; the returned one replaces it. If the edit
   * fails, the song is rebuilt as it was and the error is passed on.
   */
  commit(
    score: alphaTab.model.Score,
    edit: Edit,
    cursorBefore: Cursor,
    options: { mergeKey?: string; mergeWithLast?: boolean } = {},
  ): EditResult {
    const before = serialize(score)
    const firstBar = firstChangedBar(edit.touches)
    const undo = capture(before, edit.touches, 'before')
    let after: ScoreJs
    let cursor: Cursor
    let next: alphaTab.model.Score
    try {
      if (edit.apply) {
        cursor = edit.apply(score)
        after = serialize(score)
      } else if (edit.applyJs) {
        // The bars captured for undoing are replaced in `before`, never changed.
        after = before
        cursor = edit.applyJs(after)
      } else {
        throw new Error('An edit needs apply or applyJs')
      }
      const redo = capture(after, edit.touches, 'after')
      next = rebuild(after, this.settings)
      const last = this.undoStack[this.undoStack.length - 1]
      if (options.mergeWithLast && last) {
        this.undoStack[this.undoStack.length - 1] = {
          ...last,
          id: this.nextId++,
          redo,
          cursorAfter: cursor,
          firstBar:
            last.firstBar === undefined || firstBar === undefined ? undefined : Math.min(last.firstBar, firstBar),
          touches: [...last.touches, ...edit.touches],
          mergeKey: undefined,
        }
      } else {
        this.undoStack.push({
          id: this.nextId++,
          label: edit.label,
          undo,
          redo,
          cursorBefore,
          cursorAfter: cursor,
          firstBar,
          touches: edit.touches,
          mergeKey: options.mergeKey,
        })
        // The oldest step is forgotten; the song it led to becomes the base.
        if (this.undoStack.length > LIMIT) this.baseId = this.undoStack.shift()!.id
      }
      this.redoStack = []
    } catch (error) {
      // `apply` may have changed the song passed in, so it is rebuilt from
      // the copy taken first. `applyJs` leaves that song alone, and the
      // caller keeps using it.
      throw new EditFailed(error, edit.apply ? rebuild(before, this.settings) : null)
    }
    return { score: next, cursor, firstBar, tracks: trackChange(edit.touches, false) }
  }

  undo(score: alphaTab.model.Score): EditResult | null {
    const entry = this.undoStack.pop()
    if (!entry) return null
    const js = serialize(score)
    applyChanges(js, [...entry.undo].reverse())
    this.redoStack.push(entry)
    // A digit typed next starts a new fret, never joins one from before.
    entry.mergeKey = undefined
    const top = this.undoStack[this.undoStack.length - 1]
    if (top) top.mergeKey = undefined
    return {
      score: rebuild(js, this.settings),
      cursor: entry.cursorBefore,
      firstBar: entry.firstBar,
      tracks: trackChange(entry.touches, true),
    }
  }

  redo(score: alphaTab.model.Score): EditResult | null {
    const entry = this.redoStack.pop()
    if (!entry) return null
    const js = serialize(score)
    applyChanges(js, entry.redo)
    this.undoStack.push(entry)
    return {
      score: rebuild(js, this.settings),
      cursor: entry.cursorAfter,
      firstBar: entry.firstBar,
      tracks: trackChange(entry.touches, false),
    }
  }
}

/** An edit could not be applied. `restored` is the song as it was, when it could be rebuilt. */
export class EditFailed extends Error {
  readonly reason: unknown
  readonly restored: alphaTab.model.Score | null

  constructor(reason: unknown, restored: alphaTab.model.Score | null) {
    super(reason instanceof Error ? reason.message : String(reason))
    this.reason = reason
    this.restored = restored
  }
}
