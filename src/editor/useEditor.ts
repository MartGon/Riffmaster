import * as alphaTab from '@coderline/alphatab'
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PlayerActions, PlayerState } from '../player/usePlayer'
import { CursorLayer, stringAtY } from './cursorLayer'
import {
  defaultRhythm,
  describeFill,
  describeRhythm,
  fillValues,
  type Rhythm,
  rhythmTicks,
  stepValue,
} from './duration'
import { type Cursor, type Edit, EditFailed, EditHistory, type EditResult } from './history'
import {
  type BarClip,
  barFill,
  beatAt,
  beatRhythm,
  bendText,
  copyBars,
  FLAG_LABELS,
  flagProblem,
  flagState,
  isEditableTrack,
  MAX_FRET,
  type NoteFlag,
  noteAt,
  pasteBars,
  appendBeat,
  deleteBeat,
  deleteNote,
  insertBars,
  insertBeat,
  makeRest,
  setBeatRhythm,
  setFret,
  staffOf,
  toggleFlag,
} from './ops'
import { serialize } from './tree'

type Score = alphaTab.model.Score

export interface EditorStatus {
  /** E.g. "Bar 12, beat 3 of 8, string 2 (B)". */
  position: string
  /** What is under the cursor, e.g. "Fret 5, eighth note, hammer-on". */
  detail: string
  /** How full the bar is, or null when exactly full. */
  fill: string | null
  timeSignature: string
  section: string
  repeatStart: boolean
  /** Times the passage ending here is played, 0 for no repeat sign. */
  repeatCount: number
}

export interface EditorState {
  active: boolean
  /** Whether the track shown can be edited (drums and tracks without strings cannot). */
  editable: boolean
  cursor: Cursor
  /** Length used for new notes and rests. */
  rhythm: Rhythm
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
  hasNote: boolean
  flags: Record<NoteFlag, boolean>
  status: EditorStatus | null
  /** Bars waiting to be pasted. */
  clipBars: number
  saving: boolean
  /** Short feedback, e.g. "Copied 2 bars" or why something could not be done. */
  message: string | null
}

const noFlags = Object.fromEntries(Object.keys(FLAG_LABELS).map((flag) => [flag, false])) as Record<
  NoteFlag,
  boolean
>

const initialCursor: Cursor = { track: 0, bar: 0, beat: 0, string: 1 }

/** Letters that switch a technique on the note under the cursor. */
const FLAG_KEYS: Record<string, NoteFlag> = {
  h: 'hammer',
  s: 'slide',
  b: 'bend',
  v: 'vibrato',
  x: 'dead',
  g: 'ghost',
  p: 'palmMute',
  l: 'letRing',
  t: 'tie',
  a: 'accent',
}

/** Time allowed between the two digits of a fret such as 12. */
const SECOND_DIGIT_MS = 1000

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLTextAreaElement || target.isContentEditable) return true
  if (target instanceof HTMLSelectElement) return true
  return target instanceof HTMLInputElement && target.type !== 'range' && target.type !== 'checkbox'
}

/** Keeps a cursor inside the song: an existing bar, beat and string. */
function clampCursor(score: Score, cursor: Cursor): Cursor {
  const track = Math.min(Math.max(0, cursor.track), score.tracks.length - 1)
  const staff = staffOf(score, track)
  const bar = Math.min(Math.max(0, cursor.bar), staff.bars.length - 1)
  const beats = staff.bars[bar]?.voices[0]?.beats.length ?? 1
  const beat = Math.min(Math.max(0, cursor.beat), beats - 1)
  const strings = Math.max(1, staff.tuning.length)
  const string = Math.min(Math.max(1, cursor.string), strings)
  return { track, bar, beat, string }
}

const sameCursor = (a: Cursor, b: Cursor) =>
  a.track === b.track && a.bar === b.bar && a.beat === b.beat && a.string === b.string

function noteName(midi: number): string {
  return ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12]
}

function describe(score: Score, cursor: Cursor): EditorStatus | null {
  const staff = staffOf(score, cursor.track)
  const beats = staff?.bars[cursor.bar]?.voices[0]?.beats
  const beat = beats?.[cursor.beat]
  const masterBar = score.masterBars[cursor.bar]
  if (!staff || !beats || !beat || !masterBar) return null
  const strings = staff.tuning.length
  const openString = staff.tuning[strings - cursor.string]
  const position = `Bar ${cursor.bar + 1}, beat ${cursor.beat + 1} of ${beats.length}, string ${strings - cursor.string + 1} (${noteName(openString)})`
  let detail: string
  if (beat.isEmpty) detail = 'Nothing written in the first voice: type a fret to start it'
  else {
    const note = noteAt(score, cursor)
    const grace = beat.graceType !== alphaTab.model.GraceType.None ? 'grace ' : ''
    const rhythm = grace + describeRhythm(beatRhythm(beat), beat.notes.length === 0)
    if (!note) detail = beat.notes.length === 0 ? rhythm : `No note on this string, ${rhythm}`
    else {
      const techniques = (Object.keys(FLAG_LABELS) as NoteFlag[])
        .filter((flag) => flagState(note, flag))
        .map((flag) => (flag === 'bend' ? bendText(note) : FLAG_LABELS[flag].toLowerCase()))
      const fret = note.isDead ? 'Dead note' : `Fret ${note.fret}`
      detail = [fret, rhythm, ...techniques.filter((t) => t !== 'dead note')].join(', ')
    }
  }
  const { used, length } = barFill(score, cursor.track, cursor.bar)
  return {
    position,
    detail,
    fill: describeFill(used, length),
    timeSignature: `${masterBar.timeSignatureNumerator}/${masterBar.timeSignatureDenominator}`,
    section: masterBar.section?.text ?? '',
    repeatStart: masterBar.isRepeatStart,
    repeatCount: masterBar.repeatCount,
  }
}

export interface EditorHandlers {
  /** Stores the edited song; resolves false if it could not be saved. */
  onSave: (data: ArrayBuffer, info: { title: string; artist: string }) => Promise<boolean>
}

/**
 * The tab editor: a cursor on one string of one beat, keyboard and pointer
 * input, and undo. Each change rebuilds the song and hands it to the player.
 */
export function useEditor(
  api: alphaTab.AlphaTabApi | null,
  player: PlayerState,
  playerActions: PlayerActions,
  layerRef: RefObject<HTMLDivElement | null>,
  scoreRef: RefObject<HTMLDivElement | null>,
  handlers: EditorHandlers,
) {
  const historyRef = useRef<EditHistory | null>(null)
  const layer = useRef<CursorLayer | null>(null)
  const clip = useRef<BarClip | null>(null)
  const pendingDigit = useRef<{ key: string; value: number; at: number } | null>(null)
  /** Scroll the cursor into view at the next drawing, after it moved. */
  const scrollNext = useRef(false)
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })
  const [active, setActive] = useState(false)
  const [cursor, setCursorState] = useState<Cursor>(initialCursor)
  const [rhythm, setRhythm] = useState<Rhythm>(defaultRhythm)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** What the undo history and the clipboard hold, copied out of them after every change. */
  const [info, setInfo] = useState({
    dirty: false,
    canUndo: false,
    canRedo: false,
    undoLabel: null as string | null,
    redoLabel: null as string | null,
    clipBars: 0,
  })
  const sync = useCallback(() => {
    const edits = historyRef.current
    setInfo({
      dirty: edits?.dirty ?? false,
      canUndo: edits?.canUndo ?? false,
      canRedo: edits?.canRedo ?? false,
      undoLabel: edits?.undoLabel ?? null,
      redoLabel: edits?.redoLabel ?? null,
      clipBars: clip.current?.bars.length ?? 0,
    })
  }, [])
  const cursorRef = useRef(cursor)
  const rhythmRef = useRef(rhythm)
  useEffect(() => {
    cursorRef.current = cursor
    rhythmRef.current = rhythm
  })

  const history = useCallback(() => {
    if (!api) return null
    historyRef.current ??= new EditHistory(api.settings)
    return historyRef.current
  }, [api])

  const ready = player.status === 'ready'
  const score = ready ? api?.score ?? null : null
  const editable = isEditableTrack(score?.tracks[player.activeTrack])

  /** Moves the cursor, adopting the length of a written beat as the one for new notes. */
  const moveTo = useCallback(
    (next: Cursor, options: { scroll?: boolean } = {}) => {
      const song = api?.score
      if (!song) return
      const clamped = clampCursor(song, next)
      const beat = beatAt(song, clamped)
      if (beat && !beat.isEmpty) setRhythm(beatRhythm(beat))
      if (!sameCursor(clamped, cursorRef.current)) pendingDigit.current = null
      cursorRef.current = clamped
      scrollNext.current = options.scroll ?? true
      setCursorState(clamped)
    },
    [api],
  )

  const show = useCallback((result: EditResult) => {
    const clamped = clampCursor(result.score, result.cursor)
    cursorRef.current = clamped
    setCursorState(clamped)
    scrollNext.current = true
    playerActions.replaceScore(result.score, clamped.track, result.firstBar, result.tracks)
    sync()
  }, [playerActions, sync])

  /** Applies an edit to the song shown. Returns the rebuilt song, or null if nothing changed. */
  const commit = useCallback(
    (
      make: (song: Score, at: Cursor) => Edit | null,
      options: { mergeKey?: string; mergeWithLast?: boolean; song?: Score } = {},
    ): Score | null => {
      const edits = history()
      const song = options.song ?? api?.score
      if (!edits || !song) return null
      const at = cursorRef.current
      const edit = make(song, at)
      if (!edit) return null
      try {
        const result = edits.commit(song, edit, at, options)
        setMessage(null)
        show(result)
        return result.score
      } catch (error) {
        console.error(error)
        if (error instanceof EditFailed && error.restored) {
          playerActions.replaceScore(error.restored, at.track)
        }
        setMessage('That change could not be made.')
        return null
      }
    },
    [api, history, playerActions, show],
  )

  const undo = useCallback(() => {
    const edits = history()
    if (!edits || !api?.score) return
    pendingDigit.current = null
    const result = edits.undo(api.score)
    if (result) show(result)
  }, [api, history, show])

  const redo = useCallback(() => {
    const edits = history()
    if (!edits || !api?.score) return
    pendingDigit.current = null
    const result = edits.redo(api.score)
    if (result) show(result)
  }, [api, history, show])

  // Draw the cursor whenever the score has been laid out, and when it moves.
  const draw = useCallback(() => {
    const element = layerRef.current
    if (!element || !api) return
    if (!active) {
      layer.current?.hide()
      return
    }
    layer.current ??= new CursorLayer(element)
    if (!isEditableTrack(api.score?.tracks[cursorRef.current.track])) {
      layer.current.hide()
      return
    }
    const scroll = scrollNext.current
    if (layer.current.show(api, cursorRef.current, scroll)) scrollNext.current = false
  }, [active, api, layerRef])
  useEffect(() => {
    if (!api) return
    api.postRenderFinished.on(draw)
    return () => api.postRenderFinished.off(draw)
  }, [api, draw])
  useEffect(() => {
    draw()
  }, [cursor, draw, info])

  // The cursor follows the track shown.
  useEffect(() => {
    if (!score) return
    if (cursorRef.current.track !== player.activeTrack) {
      moveTo({ ...cursorRef.current, track: player.activeTrack, beat: 0 }, { scroll: false })
    }
  }, [moveTo, player.activeTrack, score])

  const typeDigit = useCallback(
    (digit: number) => {
      const at = cursorRef.current
      const key = `${at.track}:${at.bar}:${at.beat}:${at.string}`
      const pending = pendingDigit.current
      const now = performance.now()
      const edits = history()
      if (pending && pending.key === key && now - pending.at < SECOND_DIGIT_MS && edits?.mergeKey === key) {
        const combined = pending.value * 10 + digit
        if (combined <= MAX_FRET) {
          pendingDigit.current = null
          commit((song, c) => setFret(song, c, combined, rhythmRef.current), { mergeWithLast: true })
          return
        }
      }
      if (commit((song, c) => setFret(song, c, digit, rhythmRef.current), { mergeKey: key })) {
        pendingDigit.current = { key, value: digit, at: now }
      }
    },
    [commit, history],
  )

  const move = useCallback(
    (direction: 'left' | 'right' | 'up' | 'down' | 'barLeft' | 'barRight' | 'home' | 'end') => {
      const song = api?.score
      if (!song) return
      const at = cursorRef.current
      const staff = staffOf(song, at.track)
      const beats = staff.bars[at.bar].voices[0].beats
      switch (direction) {
        case 'up':
          return moveTo({ ...at, string: at.string + 1 })
        case 'down':
          return moveTo({ ...at, string: at.string - 1 })
        case 'home':
          return moveTo({ ...at, beat: 0 })
        case 'end':
          return moveTo({ ...at, beat: beats.length - 1 })
        case 'barLeft':
          return moveTo({ ...at, bar: at.bar - 1, beat: 0 })
        case 'barRight':
          return moveTo({ ...at, bar: at.bar + 1, beat: 0 })
        case 'left':
          if (at.beat > 0) return moveTo({ ...at, beat: at.beat - 1 })
          if (at.bar > 0) {
            const previous = staff.bars[at.bar - 1].voices[0].beats.length
            return moveTo({ ...at, bar: at.bar - 1, beat: previous - 1 })
          }
          return
        case 'right': {
          if (at.beat < beats.length - 1) return moveTo({ ...at, beat: at.beat + 1 })
          // Past the last beat: an unfinished bar gets another beat, as in
          // Guitar Pro; a full one moves on; the last bar gets a new bar after it.
          const { used, length } = barFill(song, at.track, at.bar)
          const beat = beats[at.beat]
          if (!beat.isEmpty && used < length) {
            const wanted = rhythmRef.current
            const left = length - used
            const fits = rhythmTicks(wanted) <= left ? wanted : { value: fillValues(left)[0] ?? 64, dots: 0, triplet: false }
            commit((s, c) => appendBeat(s, c, fits as Rhythm))
            return
          }
          if (at.bar < staff.bars.length - 1) return moveTo({ ...at, bar: at.bar + 1, beat: 0 })
          commit((s, c) => insertBars(s, s.masterBars.length, 1, c))
          return
        }
      }
    },
    [api, commit, moveTo],
  )

  const toggle = useCallback(
    (flag: NoteFlag) => {
      const song = api?.score
      const problem = song ? flagProblem(song, cursorRef.current, flag) : null
      if (problem) setMessage(problem)
      else commit((s, at) => toggleFlag(s, at, flag))
    },
    [api, commit],
  )

  const changeRhythm = useCallback(
    (wanted: Rhythm) => {
      // Choosing triplet or not replaces any other tuplet the beat had.
      const next = wanted.triplet !== rhythmRef.current.triplet ? { ...wanted, tuplet: undefined } : wanted
      setRhythm(next)
      rhythmRef.current = next
      commit((song, at) => setBeatRhythm(song, at, next))
    },
    [commit],
  )

  const copy = useCallback(() => {
    const song = api?.score
    if (!song) return
    const at = cursorRef.current
    const selection = playerActions.selection()
    const first = selection?.first ?? at.bar
    const last = selection?.last ?? at.bar
    clip.current = copyBars(serialize(song), at.track, first, last)
    const count = clip.current?.bars.length ?? 0
    setMessage(count === 1 ? 'Copied 1 bar' : `Copied ${count} bars`)
    sync()
  }, [api, playerActions, sync])

  const paste = useCallback(() => {
    const copied = clip.current
    let song = api?.score
    if (!copied || !song) return
    const at = cursorRef.current
    // Bars are added at the end first when the copy runs past it.
    const missing = at.bar + copied.bars.length - song.masterBars.length
    if (missing > 0) {
      song = commit((s, c) => insertBars(s, s.masterBars.length, missing, { ...c, bar: at.bar }), {}) ?? song
      cursorRef.current = at
    }
    commit((s) => pasteBars(s, at, copied), { song })
  }, [api, commit])

  const save = useCallback(async () => {
    const song = api?.score
    const edits = history()
    if (!song || !edits || !api) return false
    setSaving(true)
    try {
      const bytes = new alphaTab.exporter.Gp7Exporter().export(song, api.settings)
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      const savedAt = edits.currentId
      const ok = await handlersRef.current.onSave(data, { title: song.title.trim() || 'Untitled', artist: song.artist.trim() })
      // Only what was saved counts as saved, even if editing went on meanwhile.
      if (ok && edits.currentId === savedAt) edits.markSaved()
      setMessage(ok ? 'Saved' : 'The song could not be saved.')
      return ok
    } catch (error) {
      console.error(error)
      setMessage('The song could not be saved.')
      return false
    } finally {
      setSaving(false)
      sync()
    }
  }, [api, history, sync])

  const download = useCallback(() => {
    const song = api?.score
    if (!song || !api) return
    const bytes = new alphaTab.exporter.Gp7Exporter().export(song, api.settings)
    const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${(song.title.trim() || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-')}.gp`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
  }, [api])

  // Keyboard input while editing.
  useEffect(() => {
    if (!active || !ready) return
    const onKey = (event: KeyboardEvent) => {
      if (isTextEntry(event.target) || document.querySelector('dialog[open]')) return
      const command = event.ctrlKey || event.metaKey
      // Letters work the same with Caps Lock on.
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      const handled = () => event.preventDefault()
      // Undo, redo and save apply to the whole song, whichever track is shown.
      if (command) {
        if (key === 'z' && !event.shiftKey) return handled(), undo()
        if ((key === 'z' && event.shiftKey) || key === 'y') return handled(), redo()
        if (key === 's') return handled(), void save()
      }
      if (!isEditableTrack(api?.score?.tracks[cursorRef.current.track])) return
      if (command) {
        // Text selected on the page is copied as usual.
        if (key === 'c' && !window.getSelection()?.toString()) return handled(), copy()
        if (key === 'v') return handled(), paste()
        if (key === 'ArrowLeft') return handled(), move('barLeft')
        if (key === 'ArrowRight') return handled(), move('barRight')
        return
      }
      if (event.altKey) return
      if (/^[0-9]$/.test(key)) return handled(), typeDigit(Number(key))
      switch (key) {
        case 'ArrowLeft':
          return handled(), move('left')
        case 'ArrowRight':
          return handled(), move('right')
        case 'ArrowUp':
          return handled(), move('up')
        case 'ArrowDown':
          return handled(), move('down')
        case 'Home':
          return handled(), move('home')
        case 'End':
          return handled(), move('end')
        case 'Delete':
        case 'Backspace':
          handled()
          if (event.shiftKey) commit(deleteBeat)
          else commit(deleteNote)
          return
        case 'Insert':
        case 'i':
          return handled(), void commit((song, at) => insertBeat(song, at, rhythmRef.current))
        case '+':
        case '=':
          return handled(), changeRhythm({ ...rhythmRef.current, value: stepValue(rhythmRef.current.value, -1) })
        case '-':
          return handled(), changeRhythm({ ...rhythmRef.current, value: stepValue(rhythmRef.current.value, 1) })
        case '.':
          return handled(), changeRhythm({ ...rhythmRef.current, dots: rhythmRef.current.dots ? 0 : 1 })
        case '/':
          return handled(), changeRhythm({ ...rhythmRef.current, triplet: !rhythmRef.current.triplet })
        case 'r':
          return handled(), void commit(makeRest)
      }
      const flag = FLAG_KEYS[key]
      if (flag) {
        handled()
        toggle(flag)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, api, changeRhythm, commit, copy, move, paste, ready, redo, save, toggle, typeDigit, undo])

  // A click or tap on the tab puts the cursor on the nearest string of that beat.
  useEffect(() => {
    const host = scoreRef.current
    if (!active || !api || !host) return
    const onDown = (event: PointerEvent) => {
      const song = api.score
      if (!song || !api.boundsLookup) return
      const rect = host.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      let beat = api.boundsLookup.getBeatAtPos(x, y)
      // Only the first staff of a track has tablature to edit.
      if (!beat || beat.voice.bar.staff.track.index !== cursorRef.current.track || beat.voice.bar.staff.index !== 0) return
      // Only the first voice is edited; a click on another voice picks the beat sounding there.
      if (beat.voice.index !== 0) {
        const first = beat.voice.bar.voices[0].beats
        const start = beat.playbackStart
        beat = first.reduce((best, candidate) => (candidate.playbackStart <= start ? candidate : best), first[0])
      }
      // alphaTab finds the beat by its position across the line only; a click
      // under the tab staff is on another staff and is not for the editor.
      const place = stringAtY(api, beat, y)
      if (place === 'below') return
      const string = typeof place === 'number' ? place : cursorRef.current.string
      moveTo(
        { track: cursorRef.current.track, bar: beat.voice.bar.index, beat: beat.index, string },
        { scroll: false },
      )
    }
    host.addEventListener('pointerdown', onDown)
    return () => host.removeEventListener('pointerdown', onDown)
  }, [active, api, moveTo, scoreRef])

  // Leave the browser's warning in place while there are unsaved changes.
  const dirty = info.dirty
  useEffect(() => {
    if (!dirty) return
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [dirty])

  const state = useMemo<EditorState>(() => {
    const note = score && active ? noteAt(score, cursor) : undefined
    const flags = { ...noFlags }
    if (note) for (const flag of Object.keys(flags) as NoteFlag[]) flags[flag] = flagState(note, flag)
    let status: EditorStatus | null = null
    if (score && active && editable) {
      try {
        status = describe(score, clampCursor(score, cursor))
      } catch {
        status = null
      }
    }
    return {
      active,
      editable,
      cursor,
      rhythm,
      ...info,
      hasNote: !!note,
      flags,
      status,
      saving,
      message,
    }
  }, [active, cursor, editable, info, message, rhythm, saving, score])

  const actions = useMemo(
    () => ({
      open: () => {
        const song = api?.score
        if (song) {
          const start = clampCursor(song, { ...cursorRef.current, track: player.activeTrack })
          cursorRef.current = start
          setCursorState(start)
          scrollNext.current = false
        }
        setMessage(null)
        setActive(true)
      },
      close: () => {
        setActive(false)
        setMessage(null)
        layer.current?.hide()
      },
      /** Forgets undo steps and the cursor, for a song that was just loaded. */
      reset: () => {
        historyRef.current?.reset()
        pendingDigit.current = null
        cursorRef.current = initialCursor
        setCursorState(initialCursor)
        setMessage(null)
        sync()
      },
      undo,
      redo,
      save,
      download,
      copy,
      paste,
      move,
      typeDigit,
      commit,
      setRhythm: changeRhythm,
      /** Changes the length for new notes without changing the beat under the cursor. */
      chooseRhythm: (next: Rhythm) => {
        setRhythm(next)
        rhythmRef.current = next
      },
      toggleFlag: toggle,
      deleteNote: () => commit(deleteNote),
      deleteBeat: () => commit(deleteBeat),
      insertBeat: () => commit((song, at) => insertBeat(song, at, rhythmRef.current)),
      makeRest: () => commit(makeRest),
      dismissMessage: () => setMessage(null),
    }),
    [api, changeRhythm, commit, copy, download, move, paste, player.activeTrack, redo, save, sync, toggle, typeDigit, undo],
  )

  return { state, actions }
}

export type EditorActions = ReturnType<typeof useEditor>['actions']
