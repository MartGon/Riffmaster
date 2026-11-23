import * as alphaTab from '@coderline/alphatab'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clampSpeed } from '../lib/format'
import { loadPrefs, MAX_VOLUME, savePrefs } from '../lib/prefs'
import { startOfflineStore } from '../lib/offline'
import type { SongSettings } from '../library/types'
import { snapSelectionToBars } from '../lib/loopRange'
import { listSections, type SongSection } from '../lib/sections'
import { barAtPoint } from './barAtPoint'
import { barStartAt, leadInStart, moveAndDraw, playbackRange } from './seek'
import { splitTrackName } from '../lib/trackName'
import { isDark, onThemeChange } from '../lib/theme'
import { StaffCursorHandler, systemStaffBand, trimSelection } from './staffBand'
import { scoreColors } from './theme'

export interface TrackInfo {
  index: number
  /** Full track name as written in the file. */
  name: string
  /** The most specific part of the name, e.g. the instrument. */
  label: string
  /** Remaining context such as the player's name, "6 strings" or "Drums". */
  detail: string
  muted: boolean
  solo: boolean
  /** Volume as a factor, 1 being as written. */
  volume: number
  /** Open-string pitches as MIDI numbers, highest string first; empty for drums. */
  tuning: number[]
  /** Fret the capo sits on, 0 for none. */
  capo: number
  percussion: boolean
}

export interface PlayerState {
  status: 'empty' | 'loading' | 'ready'
  /** The last song asked for could not be opened; the player still holds the one before it. */
  loadFailed: boolean
  /** Message from the last failed action, shown until dismissed or the next load. */
  error: string | null
  title: string
  artist: string
  tracks: TrackInfo[]
  activeTrack: number
  /** True once the sound set is loaded and playback can start. */
  canPlay: boolean
  /** Sound set download progress from 0 to 1. */
  soundProgress: number
  isPlaying: boolean
  /** Elapsed and total time in milliseconds, at the current playback speed. */
  currentTime: number
  endTime: number
  /** Position and length in MIDI ticks, which do not change with the speed. */
  currentTick: number
  endTick: number
  /** Tempo written in the score, in beats per minute. */
  baseTempo: number
  /** Playback speed factor, 1 being the written tempo. */
  speed: number
  isLooping: boolean
  hasLoopRange: boolean
  metronome: boolean
  countIn: boolean
  /** Playing selected bars starts one bar before them. */
  leadIn: boolean
  showNotation: boolean
  /** Overall volume as a factor, 1 being full. */
  masterVolume: number
  /** Semitones the pitched tracks are shifted by in playback and practice; the tab is unchanged. */
  pitch: number
  /** Named parts of the song, as marked in the file. */
  sections: SongSection[]
  /** Bar the playback position is in, counted from 0. */
  currentBar: number
}

const initialState: PlayerState = {
  status: 'empty',
  loadFailed: false,
  error: null,
  title: '',
  artist: '',
  tracks: [],
  activeTrack: 0,
  canPlay: false,
  soundProgress: 0,
  isPlaying: false,
  currentTime: 0,
  endTime: 0,
  currentTick: 0,
  endTick: 0,
  baseTempo: 120,
  speed: 1,
  isLooping: false,
  hasLoopRange: false,
  metronome: false,
  countIn: false,
  leadIn: false,
  showNotation: false,
  masterVolume: 1,
  pitch: 0,
  sections: [],
  currentBar: 0,
}

function describeTrack(track: alphaTab.model.Track): TrackInfo {
  const name = track.name.trim() || `Track ${track.index + 1}`
  const { label, context } = splitTrackName(name)
  const staff = track.staves[0]
  let kind = ''
  if (staff?.isPercussion) kind = 'Drums'
  else if (staff && staff.tuning.length > 0) kind = `${staff.tuning.length} strings`
  return {
    index: track.index,
    name,
    label,
    detail: [context, kind].filter(Boolean).join(' · '),
    muted: false,
    solo: false,
    volume: 1,
    tuning: staff && !staff.isPercussion ? [...staff.tuning] : [],
    capo: staff?.capo ?? 0,
    percussion: staff?.isPercussion ?? false,
  }
}

type TickLookup = NonNullable<alphaTab.AlphaTabApi['tickCache']>

/** The furthest a song can be shifted, in semitones either way. */
export const MAX_PITCH = 12

function clampPitch(pitch: number | undefined): number {
  return Number.isFinite(pitch) ? Math.max(-MAX_PITCH, Math.min(MAX_PITCH, Math.round(pitch as number))) : 0
}

/** Shifts every pitched track of the song; drums keep their sounds. */
function applyPitch(api: alphaTab.AlphaTabApi, score: alphaTab.model.Score, pitch: number) {
  const pitched = score.tracks.filter((track) => !track.staves.some((staff) => staff.isPercussion))
  if (pitched.length > 0) api.changeTrackTranspositionPitch(pitched, pitch)
}

/** Index into the lookup's bars of the one being played at `tick`, searching outwards from `hint`. */
function lookupIndexAtTick(lookup: TickLookup, tick: number, hint: number): number {
  const bars = lookup.masterBars
  if (bars.length === 0) return -1
  let index = Math.min(Math.max(hint, 0), bars.length - 1)
  while (index > 0 && tick < bars[index].start) index--
  while (index < bars.length - 1 && tick >= bars[index].end) index++
  return index
}

/**
 * Where playback with a count-in should begin: the start of the bar the
 * position is in (but not before a selection's start), or null when it is
 * there already. Begun mid-bar, alphaTab's count-in would count on to that
 * beat: a bar of clicks plus one for each beat already gone.
 */
function countInStart(api: alphaTab.AlphaTabApi): number | null {
  const lookup = api.tickCache
  const tick = api.tickPosition
  const bar = lookup ? barStartAt(lookup, tick) : null
  if (bar === null) return null
  const start = Math.max(bar, api.playbackRange?.startTick ?? 0)
  // The player reports a position a tick or so past the one it was sent to.
  return tick - start > 4 ? start : null
}

/** First beat of bar `first` and last beat of bar `last` of a track, to highlight those bars. */
function barsBeats(track: alphaTab.model.Track | undefined, first: number, last: number) {
  const bars = track?.staves[0]?.bars
  const start = bars?.[first]?.voices[0]?.beats[0]
  const end = bars?.[last]?.voices[0]?.beats.at(-1)
  return start && end ? { start, end } : null
}

/** First bar with a single note to play and score, or -1. */
function firstSingleNoteBar(track: alphaTab.model.Track | undefined): number {
  const bars = track?.staves[0]?.bars ?? []
  return bars.findIndex((bar) =>
    bar.voices.some((voice) =>
      voice.beats.some(
        (beat) =>
          !beat.isRest &&
          beat.graceType === 0 &&
          beat.notes.filter((note) => !note.isDead && !note.isTieDestination).length === 1,
      ),
    ),
  )
}

/** Whether a track has notes that a first go at the song can be scored on. */
function canLearnOn(track: alphaTab.model.Track): boolean {
  return !track.staves.some((staff) => staff.isPercussion) && firstSingleNoteBar(track) >= 0
}

/**
 * Forgets the beats alphaTab has highlighted. `clearPlaybackRangeHighlight`
 * only takes the drawing away and keeps the beats; both ends on one beat is
 * what alphaTab treats as nothing highlighted.
 */
function forgetHighlight(api: alphaTab.AlphaTabApi, track: alphaTab.model.Track | undefined) {
  const anyBeat = track?.staves[0]?.bars[0]?.voices[0]?.beats[0]
  if (anyBeat) api.highlightPlaybackRange(anyBeat, anyBeat)
}

/** Tick at which a bar is first played, or null if playback never reaches it. */
function firstTickOfBar(lookup: TickLookup, barIndex: number): number | null {
  for (const bar of lookup.masterBars) {
    if (bar.masterBar.index === barIndex) return bar.start
  }
  return null
}

/** Picks the track to show first: a guitar if there is one, else a bass, else the first track. */
function defaultTrackIndex(score: alphaTab.model.Score): number {
  const isPitched = (track: alphaTab.model.Track) => !track.staves[0]?.isPercussion
  const inFamily = (first: number, last: number) =>
    score.tracks.find((track) => {
      const program = track.playbackInfo.program
      return isPitched(track) && program >= first && program <= last
    })
  // General MIDI programs 24-31 are guitars and 32-39 are basses.
  return (inFamily(24, 31) ?? inFamily(32, 39) ?? score.tracks[0])?.index ?? 0
}

/**
 * How a track is drawn. Tracks without strings (drums, voices, piano, as in
 * many MusicXML and Capella files) have no tablature, so they are always
 * shown in standard notation: asking alphaTab for tab only then leaves it
 * with no staff to draw, and it fails.
 */
function staveProfileFor(track: alphaTab.model.Track | undefined, showNotation: boolean) {
  if (track && !track.staves.some((staff) => staff.isStringed && !staff.isPercussion)) {
    return alphaTab.StaveProfile.Score
  }
  return showNotation ? alphaTab.StaveProfile.ScoreTab : alphaTab.StaveProfile.Tab
}

/** Phones held sideways: wide but short. */
export const SIDEWAYS = '(max-height: 500px)'

/** The 1 MB sound bank that comes with alphaTab, always present in the app. */
const SMALL_SOUND_BANK = 'soundfont/sonivox.sf3'
/** Path of the sound bank the player loads, chosen in next.config.mjs. */
const SOUND_BANK = process.env.NEXT_PUBLIC_SOUND_BANK ?? SMALL_SOUND_BANK

/**
 * How the score is laid out. Held sideways, a phone shows the tab as one
 * long line that scrolls across, at a larger size, since the height is
 * what is short; otherwise lines run down the page.
 */
function layoutFor() {
  if (window.matchMedia(SIDEWAYS).matches) {
    return { layoutMode: alphaTab.LayoutMode.Horizontal, scale: 1.4 }
  }
  return { layoutMode: alphaTab.LayoutMode.Page, scale: window.innerWidth < 600 ? 0.8 : 1 }
}

/**
 * Scrolls the view to the playback position: across when the tab is one
 * long line, down otherwise. With `reset`, the other direction goes back
 * to the start (after the layout changed).
 */
function scrollToPosition(api: alphaTab.AlphaTabApi, viewport: HTMLElement, reset = false) {
  const lookup = api.tickCache
  const track = api.tracks[0]
  const found = lookup && track ? lookup.findBeat(new Set([track.index]), api.tickPosition) : null
  const box = found ? api.boundsLookup?.findBeat(found.beat)?.visualBounds : null
  if (reset) viewport.scrollTo({ left: 0, top: 0 })
  if (!box) return
  if (api.settings.display.layoutMode === alphaTab.LayoutMode.Horizontal) {
    viewport.scrollTo({ left: Math.max(0, box.x - 40), top: reset ? 0 : viewport.scrollTop })
  } else {
    viewport.scrollTo({ left: reset ? 0 : viewport.scrollLeft, top: Math.max(0, box.y - 40) })
  }
}

/** The audio context alphaTab plays through, if it has one yet. */
function audioContextOf(api: alphaTab.AlphaTabApi): AudioContext | null {
  try {
    const output = api.player?.output as { context?: AudioContext | null } | undefined
    return output?.context ?? null
  } catch {
    return null
  }
}

const preparedContexts = new WeakSet<BaseAudioContext>()

/**
 * Gets the audio worklet ready for alphaTab's code. Next.js ends each script
 * file of the app with `_N_E = ...`, which also runs when alphaTab loads its
 * files into the worklet. There `_N_E` was never declared, and worklet code
 * is strict, so that line throws. Chromium registers alphaTab's processor
 * anyway; Safari's engine (every browser on an iPhone) does not, and Play
 * then does nothing ("Can't find variable: _N_E"). Declaring it first, in a
 * module of its own, makes the line harmless. Worklet modules share one
 * global scope, so it only has to be added once per audio context, before
 * the first Play.
 */
function prepareWorkletScope(api: alphaTab.AlphaTabApi): void {
  const context = audioContextOf(api)
  if (!context?.audioWorklet || preparedContexts.has(context)) return
  preparedContexts.add(context)
  const url = URL.createObjectURL(new Blob(['globalThis._N_E = globalThis._N_E;'], { type: 'text/javascript' }))
  // Should it fail, alphaTab's own attempt reports it, and Play is retried.
  context.audioWorklet
    .addModule(url)
    .catch(() => {})
    .finally(() => URL.revokeObjectURL(url))
}

let loggerHooked = false

/** Called when alphaTab could not set up the audio worklet that plays the song. */
const workletFailureListeners = new Set<() => void>()

/**
 * Watches alphaTab's log for a failed audio worklet, which alphaTab itself
 * only writes to the console, and reports it to the player.
 */
function hookAlphaTabLogger(): void {
  if (loggerHooked) return
  loggerHooked = true
  const previous = alphaTab.Logger.log
  alphaTab.Logger.log = {
    debug: (category, msg, ...details) => previous.debug(category, msg, ...details),
    info: (category, msg, ...details) => previous.info(category, msg, ...details),
    warning: (category, msg, ...details) => previous.warning(category, msg, ...details),
    error: (category, msg, ...details) => {
      previous.error(category, msg, ...details)
      if (category === 'WebAudio' && msg.startsWith('Audio Worklet operation failed')) {
        for (const listener of workletFailureListeners) listener()
      }
    },
  }
}

/**
 * Wakes the audio up. iOS suspends or interrupts it when the page goes to
 * the background, the screen locks, or the audio mode changes (the
 * microphone opening and closing); it can only be resumed from a tap.
 * Returns whether it was asleep.
 */
function wakeAudio(api: alphaTab.AlphaTabApi): boolean {
  const context = audioContextOf(api)
  if (!context || context.state === 'running' || context.state === 'closed') return false
  void context.resume().catch(() => {})
  return true
}

/**
 * Owns the alphaTab instance: renders the score into `scoreRef`, scrolls
 * `viewportRef` to follow playback, and exposes player state and actions.
 */
export function usePlayer() {
  const scoreRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null)
  /** Set while Play waits for the jump back to the bar's start before playing. */
  const startingPlay = useRef(false)
  /** The selection, while playback is widened to run up to it from the bar before. */
  const leadIn = useRef<{ startTick: number; endTick: number } | null>(null)
  /** What the range goes back to while a practice take has widened it. */
  const heldRange = useRef<{ range: { startTick: number; endTick: number } | null } | null>(null)
  /** Puts the playback range back on the selection, keeping a position inside it. */
  const releaseLeadIn = useCallback(() => {
    const selected = leadIn.current
    const api = apiRef.current
    leadIn.current = null
    if (!selected || !api) return
    const tick = api.tickPosition
    api.playbackRange = playbackRange(selected)
    // Set either way: the position alphaTab shows does not follow a new range by itself.
    api.tickPosition = tick > selected.startTick && tick < selected.endTick ? tick : selected.startTick
  }, [])
  // Settings of the song being loaded, applied once its score arrives.
  const pendingSettings = useRef<SongSettings | null>(null)
  /** Bars of the current selection, so it can be drawn again on another track. */
  const selectedBars = useRef<{ first: number; last: number } | null>(null)
  /** Position and looping to keep when an edited version of the song replaces it. */
  const keepAfterEdit = useRef<{
    tick: number
    isLooping: boolean
    selection: { first: number; last: number } | null
  } | null>(null)
  /**
   * A selection to put back after an edit. It can only be drawn once the
   * edited song has been laid out, and applied once its MIDI exists.
   */
  const restoreSelection = useRef<{ first: number; last: number; drawn: boolean; midi: boolean } | null>(null)
  /**
   * Bars to loop as soon as the song being loaded can show and play them.
   * `score` is set once that song has arrived, so a drawing of the song before it does not count.
   */
  const loopAfterLoad = useRef<{
    first: number
    last: number
    /** Starts at the first bar with notes to play, on a track that has some, instead of at `first`. */
    firstPlayed?: boolean
    score: alphaTab.model.Score | null
    drawn: boolean
    midi: boolean
  } | null>(null)
  const [api, setApi] = useState<alphaTab.AlphaTabApi | null>(null)
  const [state, setState] = useState<PlayerState>(() => ({ ...initialState, ...loadPrefs() }))
  /**
   * Choosing bars by tapping, for touch screens where dragging scrolls:
   * null when off, otherwise the first bar tapped so far (or null).
   */
  const [picking, setPicking] = useState<{ first: number | null } | null>(null)
  const pickingRef = useRef(picking)
  const actionsRef = useRef<{ selectBars: (first: number, last: number, loop: boolean) => void } | null>(null)
  useEffect(() => {
    pickingRef.current = picking
  })

  // While picking, a tap on the tab chooses a bar. alphaTab does not get
  // the tap: on its own it would move the position and drop the selection.
  // Dragging still scrolls, since nothing stops the browser's own handling.
  // A touch delivers mouse events after the finger lifts, so taps are kept
  // from alphaTab a little longer than the picking itself lasts.
  useEffect(() => {
    const element = scoreRef.current
    const host = element?.parentElement
    if (!element || !host) return
    let down: { x: number; y: number } | null = null
    let swallowUntil = 0
    const active = () => pickingRef.current !== null || performance.now() < swallowUntil
    const swallow = (event: Event) => {
      if (active()) event.stopPropagation()
    }
    const onDown = (event: PointerEvent) => {
      if (!active()) return
      event.stopPropagation()
      down = { x: event.clientX, y: event.clientY }
    }
    const onUp = (event: PointerEvent) => {
      if (!active()) return
      event.stopPropagation()
      const current = pickingRef.current
      const api = apiRef.current
      // A drag is a scroll, not a tap.
      if (!current || !api || !down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 10) return
      down = null
      const rect = element.getBoundingClientRect()
      const bar = barAtPoint(api, event.clientX - rect.left, event.clientY - rect.top)
      if (bar === null) return
      swallowUntil = performance.now() + 600
      if (current.first === null) {
        pickingRef.current = { first: bar }
        setPicking({ first: bar })
        actionsRef.current?.selectBars(bar, bar, false)
      } else {
        pickingRef.current = null
        setPicking(null)
        actionsRef.current?.selectBars(Math.min(current.first, bar), Math.max(current.first, bar), false)
      }
    }
    const blocked = ['pointermove', 'mousedown', 'mousemove', 'mouseup', 'click'] as const
    host.addEventListener('pointerdown', onDown, true)
    host.addEventListener('pointerup', onUp, true)
    for (const type of blocked) host.addEventListener(type, swallow, true)
    return () => {
      host.removeEventListener('pointerdown', onDown, true)
      host.removeEventListener('pointerup', onUp, true)
      for (const type of blocked) host.removeEventListener(type, swallow, true)
    }
  }, [])

  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })

  useEffect(() => {
    const element = scoreRef.current
    const viewport = viewportRef.current
    if (!element || !viewport) return

    const base = '/'
    const prefs = loadPrefs()
    hookAlphaTabLogger()
    const api = new alphaTab.AlphaTabApi(element, {
      // Note positions are needed to draw practice marks next to the notes.
      core: { fontDirectory: `${base}font/`, includeNoteBounds: true },
      display: {
        ...layoutFor(),
        staveProfile: prefs.showNotation
          ? alphaTab.StaveProfile.ScoreTab
          : alphaTab.StaveProfile.Tab,
        resources: scoreColors(isDark()),
      },
      player: {
        playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
        soundFont: `${base}${SOUND_BANK}`,
        scrollElement: viewport,
        scrollOffsetY: -24,
        enableCursor: true,
        enablePlaybackRangeSelection: true,
      },
    })
    // Cursors as tall as the staves, not as the tempo and markers above them.
    api.customCursorHandler = new StaffCursorHandler()
    prepareWorkletScope(api)
    apiRef.current = api
    setApi(api)
    api.metronomeVolume = prefs.metronome ? 1 : 0
    api.countInVolume = prefs.countIn ? 1 : 0
    api.masterVolume = prefs.masterVolume
    const patch = (partial: Partial<PlayerState>) => setState((s) => ({ ...s, ...partial }))

    // The larger sound bank is a 32 MB download, which can fail: seen on a
    // first visit to the built app, where the page and the offline cache
    // fetch it at the same time. It is tried once more under another
    // address, then the small bank that comes with alphaTab is used.
    let soundFailures = 0
    let soundRetry = 0
    api.player?.soundFontLoadFailed.on(() => {
      soundFailures++
      const bank = soundFailures === 1 ? `${SOUND_BANK}?retry=1` : SMALL_SOUND_BANK
      if (soundFailures > 2 || (soundFailures === 2 && SOUND_BANK === SMALL_SOUND_BANK)) {
        patch({ error: 'The instrument sounds could not be loaded, so nothing can be played. Reload the page to try again.' })
        startOfflineStore()
        return
      }
      soundRetry = window.setTimeout(() => api.loadSoundFontFromUrl(`${base}${bank}`, false), 1500)
    })

    api.error.on((error) => {
      // A failed sound download is handled above.
      if (error instanceof alphaTab.FileLoadError) return
      // A failed load leaves the previous score (if any) in place. alphaTab
      // logs the technical detail to the console.
      loopAfterLoad.current = null
      setState((s) => ({
        ...s,
        status: api.score ? 'ready' : 'empty',
        loadFailed: s.loadFailed || s.status === 'loading',
        error:
          s.status === 'loading'
            ? 'This file could not be opened. It may be damaged or in a format that is not supported.'
            : error.message || 'Something went wrong.',
      }))
    })

    api.scoreLoaded.on((score) => {
      if (loopAfterLoad.current) loopAfterLoad.current.score = score
      const settings = pendingSettings.current
      const speed = clampSpeed(settings?.speed ?? 1)
      const pitch = clampPitch(settings?.pitch)
      const kept = keepAfterEdit.current
      api.playbackSpeed = speed
      api.isLooping = kept?.isLooping ?? false
      const wanted = settings?.trackIndex ?? null
      let first =
        wanted !== null && score.tracks.some((track) => track.index === wanted)
          ? wanted
          : defaultTrackIndex(score)
      if (loopAfterLoad.current?.firstPlayed && !canLearnOn(score.tracks[first])) {
        first = score.tracks.find(canLearnOn)?.index ?? first
      }
      const firstTrack = score.tracks.find((track) => track.index === first)
      // A selection belongs to the song it was made in. alphaTab keeps both
      // the section to play and the highlighted beats across a load, so
      // they are dropped here (see `showTrack` for the highlight).
      selectedBars.current = null
      api.playbackRange = null
      forgetHighlight(api, firstTrack)
      const profile = staveProfileFor(firstTrack, loadPrefs().showNotation)
      if (api.settings.display.staveProfile !== profile) {
        api.settings.display.staveProfile = profile
        api.updateSettings()
      }
      if (firstTrack && api.tracks[0] !== firstTrack) api.renderTracks([firstTrack])
      const muted = new Set(settings?.mutedTracks ?? [])
      const solo = new Set(settings?.soloTracks ?? [])
      patch({
        status: 'ready',
        loadFailed: false,
        error: null,
        title: score.title || 'Untitled',
        artist: score.artist,
        tracks: score.tracks.map((track) => ({
          ...describeTrack(track),
          muted: muted.has(track.index),
          solo: solo.has(track.index),
          volume: settings?.volumes?.[track.index] ?? 1,
        })),
        activeTrack: first,
        baseTempo: score.tempo,
        speed,
        pitch,
        isLooping: kept?.isLooping ?? false,
        hasLoopRange: false,
        isPlaying: false,
        currentTime: 0,
        endTime: 0,
        currentTick: kept?.tick ?? 0,
        endTick: 0,
        sections: listSections(score.masterBars),
        currentBar: 0,
      })
    })

    /** Selects the remembered bars of an edited song again, once it is drawn and playable. */
    const putBackSelection = () => {
      const wanted = restoreSelection.current
      if (!wanted?.drawn || !wanted.midi) return
      restoreSelection.current = null
      const count = api.tracks[0]?.staves[0]?.bars.length ?? 0
      const first = Math.min(wanted.first, count - 1)
      const last = Math.min(wanted.last, count - 1)
      const beats = barsBeats(api.tracks[0], first, last)
      if (!beats) return
      try {
        selectedBars.current = { first, last }
        // Applying a range moves the position to its start; keep where it was.
        const tick = api.tickPosition
        api.highlightPlaybackRange(beats.start, beats.end)
        api.applyPlaybackRangeFromHighlight()
        const range = api.playbackRange
        if (range && tick >= range.startTick && tick <= range.endTick) api.tickPosition = tick
      } catch (error) {
        // Losing the selection is better than breaking the player.
        console.warn('The selection could not be put back after an edit', error)
      }
    }
    /** Loops the bars asked for when the song was loaded, once it is drawn and playable. */
    const applyLoopAfterLoad = () => {
      const wanted = loopAfterLoad.current
      if (!wanted?.drawn || !wanted.midi) return
      loopAfterLoad.current = null
      const count = api.tracks[0]?.staves[0]?.bars.length ?? 0
      if (count === 0) return
      // The song may have been edited to fewer bars since the plan was made.
      const from = wanted.firstPlayed ? Math.max(0, firstSingleNoteBar(api.tracks[0])) : wanted.first
      const first = Math.min(from, count - 1)
      actionsRef.current?.selectBars(first, Math.min(first + wanted.last - wanted.first, count - 1), true)
      if (viewportRef.current) scrollToPosition(api, viewportRef.current)
    }
    const onDrawn = () => {
      if (loopAfterLoad.current?.score && loopAfterLoad.current.score === api.score) {
        loopAfterLoad.current.drawn = true
        applyLoopAfterLoad()
      }
      if (!restoreSelection.current) return
      restoreSelection.current.drawn = true
      putBackSelection()
    }
    api.postRenderFinished.on(onDrawn)

    /** Reloads of the song's MIDI data made only to leave a count-in; they change nothing else. */
    let quietMidiLoads = 0
    // Mute and solo live in the synthesizer, which is ready for the new
    // song once its MIDI data has been generated.
    api.midiLoaded.on(() => {
      if (quietMidiLoads > 0) {
        quietMidiLoads--
        return
      }
      const settings = pendingSettings.current
      const score = api.score
      const kept = keepAfterEdit.current
      keepAfterEdit.current = null
      if (kept && api.tickCache) {
        api.tickPosition = Math.min(kept.tick, api.tickCache.masterBars.at(-1)?.end ?? 0)
        if (restoreSelection.current) {
          restoreSelection.current.midi = true
          putBackSelection()
        }
      }
      if (!score) return
      if (rebuilt) {
        if (!rebuilt.sounds) return
        const back = rebuilt
        rebuilt = null
        const tracks = stateRef.current.tracks
        const info = (index: number) => tracks.find((t) => t.index === index)
        applyMixer(
          score,
          (index) => info(index)?.muted ?? false,
          (index) => info(index)?.solo ?? false,
          (index) => info(index)?.volume ?? 1,
          stateRef.current.pitch,
        )
        if (back.range) api.playbackRange = playbackRange(back.range)
        api.tickPosition = back.tick
        return
      }
      applyMixer(
        score,
        (index) => settings?.mutedTracks?.includes(index) ?? false,
        (index) => settings?.soloTracks?.includes(index) ?? false,
        (index) => settings?.volumes?.[index] ?? 1,
        clampPitch(settings?.pitch),
      )
      if (loopAfterLoad.current?.score === score) {
        loopAfterLoad.current.midi = true
        applyLoopAfterLoad()
      }
    })
    /**
     * Sets every track's mute, solo, volume and pitch shift in the
     * synthesizer. It keeps them by channel across loads: a track soloed in the last song would
     * leave this one silent, its tracks being on other channels, and an old
     * volume would linger. So they are cleared first, and every track's
     * volume is set, including those at 100%.
     */
    function applyMixer(
      score: alphaTab.model.Score,
      muted: (index: number) => boolean,
      solo: (index: number) => boolean,
      volume: (index: number) => number,
      pitch: number,
    ) {
      api.player?.resetChannelStates()
      const mutedTracks = score.tracks.filter((t) => muted(t.index))
      const soloTracks = score.tracks.filter((t) => solo(t.index))
      if (mutedTracks.length > 0) api.changeTrackMute(mutedTracks, true)
      if (soloTracks.length > 0) api.changeTrackSolo(soloTracks, true)
      for (const track of score.tracks) api.changeTrackVolume([track], volume(track.index))
      if (pitch !== 0) applyPitch(api, score, pitch)
    }

    // Should alphaTab still fail to set up its audio worklet (see
    // prepareWorkletScope for the known cause), playback is started again a
    // few times, then the player says it could not start.
    let workletRetries = 0
    const retryAfterWorkletFailure = () => {
      if (workletRetries >= 3) {
        workletRetries = 0
        rebuildAudio()
        return
      }
      workletRetries++
      window.setTimeout(() => {
        if (api.playerState !== alphaTab.synth.PlayerState.Playing) return
        api.pause()
        api.play()
      }, 100 * workletRetries)
    }
    workletFailureListeners.add(retryAfterWorkletFailure)

    api.soundFontLoad.on((progress) => {
      patch({ soundProgress: progress.total > 0 ? progress.loaded / progress.total : 0 })
    })
    api.playerReady.on(() => {
      prepareWorkletScope(api)
      watchOutput()
      patch({ canPlay: true, soundProgress: 1 })
      startOfflineStore()
    })
    // Should the sounds never arrive, the rest of the app is still stored.
    const offlineTimer = window.setTimeout(startOfflineStore, 60000)
    // Sound actually rendered, as reported by alphaTab's audio output. A
    // count-in renders sound too, though the position does not move.
    let lastSound = 0
    let watchedOutput: unknown = null
    const watchOutput = () => {
      const output = api.player?.output
      if (!output || output === watchedOutput) return
      watchedOutput = output
      output.samplesPlayed.on(() => {
        lastSound = performance.now()
        workletRetries = 0
      })
    }

    // Playing without any sound being rendered has two causes on iOS. The
    // system may have suspended the audio (the screen locked, another app
    // played): then playback is paused, and the next tap on Play wakes it.
    // Or the audio runs but alphaTab's output is stuck, waiting for a step
    // that never finishes; every later Play would queue behind it. Then the
    // output is built anew, which needs no reload of the page.
    let stallTimer = 0
    const watchStall = () => {
      window.clearInterval(stallTimer)
      watchOutput()
      const started = performance.now()
      stallTimer = window.setInterval(() => {
        if (api.playerState !== alphaTab.synth.PlayerState.Playing) {
          window.clearInterval(stallTimer)
          return
        }
        if (performance.now() - Math.max(lastSound, started) < 3000) return
        window.clearInterval(stallTimer)
        if (audioContextOf(api)?.state === 'running') {
          rebuildAudio()
          return
        }
        api.pause()
        patch({ error: 'Playback stopped because the phone paused the sound. Press Play to go on.' })
      }, 500)
    }

    /** What to put back once a rebuilt output has the song again. */
    let rebuilt: {
      tick: number
      range: { startTick: number; endTick: number } | null
      /** Whether the sounds are in the new output; the song is loaded again after them. */
      sounds: boolean
    } | null = null
    /**
     * Throws away alphaTab's audio output and makes a new one: a new audio
     * context, the sounds and the song loaded into it again. Position,
     * selection and the mixer are kept.
     */
    function rebuildAudio() {
      if (rebuilt) return
      window.clearInterval(stallTimer)
      releaseLeadIn()
      // A take's own wider range ends with the take, so it is not the one to put back.
      const held = heldRange.current
      const range = held ? held.range : api.playbackRange
      const atTick = api.tickPosition
      rebuilt = {
        tick: held?.range && (atTick < held.range.startTick || atTick >= held.range.endTick) ? held.range.startTick : atTick,
        range: range ? { startTick: range.startTick, endTick: range.endTick } : null,
        sounds: false,
      }
      // Destroying the old output stops its wait and closes its audio context.
      watchedOutput = null
      // A reload sent to the old player is never reported now.
      quietMidiLoads = 0
      api.settings.player.playerMode = alphaTab.PlayerMode.Disabled
      api.updateSettings()
      api.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer
      api.updateSettings()
      patch({
        isPlaying: false,
        canPlay: false,
        soundProgress: 0,
        error: 'The sound had stopped working and has been set up again. Press Play to go on.',
      })
    }
    // A new output loads the song before the sounds, and the song's
    // instruments are only taken from the sounds as the song loads: without
    // loading it again, it would play in silence.
    api.soundFontLoaded.on(() => {
      if (!rebuilt || rebuilt.sounds) return
      rebuilt.sounds = true
      api.loadMidiForScore()
    })
    // alphaTab only goes from a count-in to the song when the count-in has
    // played to its end. Stopped during one, it stays on the count-in: the
    // next count-in then has the wrong number of clicks, and the position
    // (and with it the cursor) is not reported while it thinks it is still
    // counting in. Loading the song's MIDI data again puts it back on the
    // song; mute, solo and volumes stay as they are in the synthesizer.
    let countingIn = false
    const leaveCountIn = () => {
      const tick = api.tickPosition
      const range = api.playbackRange
      const kept = range ? playbackRange(range) : null
      quietMidiLoads++
      api.loadMidiForScore()
      // Loading goes back to the start; these follow it to the synthesizer in order.
      if (kept) api.playbackRange = kept
      api.tickPosition = tick
    }
    api.playerStateChanged.on((args) => {
      const playing = args.state === alphaTab.synth.PlayerState.Playing
      if (playing) {
        countingIn = api.countInVolume > 0
        watchStall()
      } else {
        window.clearInterval(stallTimer)
        releaseLeadIn()
        if (countingIn && !rebuilt) leaveCountIn()
        countingIn = false
      }
      patch({ isPlaying: playing })
    })
    api.playerPositionChanged.on((args) => {
      if (!args.isSeek) countingIn = false
    })
    // Coming back to the page is a good moment to wake the audio; iOS may
    // still insist on a tap, which Play then provides.
    const onVisible = () => {
      if (document.visibilityState === 'visible') wakeAudio(api)
    }
    document.addEventListener('visibilitychange', onVisible)
    let barHint = 0
    api.playerPositionChanged.on((args) => {
      // alphaTab occasionally plays on past the end of a looped selection
      // (seen on the first playback after a song opens); then it is sent back.
      const range = api.playbackRange
      if (api.isLooping && range && args.currentTick > range.endTick + 480 && !args.isSeek) {
        api.tickPosition = range.startTick
        return
      }
      const lookup = api.tickCache
      const found = lookup ? lookupIndexAtTick(lookup, args.currentTick, barHint) : -1
      if (found >= 0) barHint = found
      const bar = found >= 0 ? lookup!.masterBars[found].masterBar.index : null
      setState((s) => ({
        ...s,
        currentTime: args.currentTime,
        endTime: args.endTime,
        currentTick: args.currentTick,
        endTick: args.endTick,
        currentBar: bar ?? s.currentBar,
      }))
    })
    api.playbackRangeChanged.on((args) => {
      if (args.playbackRange === null) {
        selectedBars.current = null
        leadIn.current = null
      }
      patch({ hasLoopRange: args.playbackRange !== null })
    })

    // Dragging over the tab selects beats; once the drag ends, widen the
    // selection to whole bars so loops start and end on bar lines.
    let highlight: alphaTab.PlaybackHighlightChangeEventArgs | null = null
    let snapping = false
    api.playbackRangeHighlightChanged.on((args) => {
      trimSelection(api, element, args.highlightBlocks)
      if (!snapping) highlight = args
    })
    api.beatMouseUp.on(() => {
      const selection = highlight
      highlight = null
      if (!selection?.startBeat || !selection.endBeat) return
      if (selection.startBeat === selection.endBeat) return
      const { start, end } = snapSelectionToBars(selection.startBeat, selection.endBeat)
      selectedBars.current = { first: start.voice.bar.index, last: end.voice.bar.index }
      leadIn.current = null
      // Deferred so alphaTab finishes its own mouse-up handling first.
      window.setTimeout(() => {
        if (apiRef.current !== api) return
        snapping = true
        api.highlightPlaybackRange(start, end)
        api.applyPlaybackRangeFromHighlight()
        snapping = false
      }, 0)
    })

    // Re-colour the score when the theme changes.
    const stopThemeWatch = onThemeChange(() => {
      api.settings.fillFromJson({ display: { resources: scoreColors(isDark()) } })
      api.updateSettings()
      if (api.score) api.render()
    })

    // Turning the phone changes the layout.
    const sideways = window.matchMedia(SIDEWAYS)
    // The old scroll position means nothing in the new layout, so once it
    // is drawn the view goes to the playback position.
    const showPosition = () => {
      api.postRenderFinished.off(showPosition)
      scrollToPosition(api, viewport, true)
    }
    const onTurn = () => {
      const layout = layoutFor()
      api.settings.display.layoutMode = layout.layoutMode
      api.settings.display.scale = layout.scale
      api.updateSettings()
      if (!api.score) return
      api.postRenderFinished.off(showPosition)
      api.postRenderFinished.on(showPosition)
      api.render()
    }
    sideways.addEventListener('change', onTurn)

    // Held sideways the tab is one line, so it only scrolls across, with its
    // staves in the middle of the height. What alphaTab draws above and below
    // them (tempo, section names, dynamics) may be cut off. Up and down stays
    // possible only when the staves themselves are taller than the screen
    // (with standard notation, say).
    const wrap = element.parentElement
    const checkFit = () => {
      const system = api.boundsLookup?.staffSystems[0]
      const band = sideways.matches && system ? systemStaffBand(system) : null
      const tall = band !== null && band.h > viewport.clientHeight
      viewport.classList.toggle('scroll-tall', tall)
      if (!wrap) return
      // The score's top within the wrap, which moves with it.
      const centred = band && !tall ? viewport.clientHeight / 2 - element.offsetTop - (band.y + band.h / 2) : null
      wrap.style.marginTop = centred === null ? '' : `${Math.round(centred)}px`
    }
    api.postRenderFinished.on(checkFit)
    const resized = new ResizeObserver(checkFit)
    resized.observe(viewport)
    sideways.addEventListener('change', checkFit)

    return () => {
      stopThemeWatch()
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(stallTimer)
      window.clearTimeout(soundRetry)
      window.clearTimeout(offlineTimer)
      sideways.removeEventListener('change', onTurn)
      sideways.removeEventListener('change', checkFit)
      api.postRenderFinished.off(checkFit)
      resized.disconnect()
      workletFailureListeners.delete(retryAfterWorkletFailure)
      api.postRenderFinished.off(showPosition)
      apiRef.current = null
      setApi(null)
      api.destroy()
      setState({ ...initialState, ...loadPrefs() })
    }
  }, [releaseLeadIn])

  /** Loads a tab file's bytes and applies the song's remembered settings, optionally looping some bars once it is ready. */
  const load = useCallback((data: ArrayBuffer, settings: SongSettings, loopBars?: { first: number; last: number; firstPlayed?: boolean } | null) => {
    const api = apiRef.current
    if (!api) return
    api.stop()
    keepAfterEdit.current = null
    restoreSelection.current = null
    leadIn.current = null
    heldRange.current = null
    loopAfterLoad.current = loopBars ? { ...loopBars, score: null, drawn: false, midi: false } : null
    // A new song starts without a half-made choice of bars.
    setPicking(null)
    pendingSettings.current = settings
    setState((s) => ({ ...s, status: 'loading', loadFailed: false, error: null }))
    api.load(new Uint8Array(data), [0])
  }, [])

  const actions = useMemo(() => {
    const withApi = (run: (api: alphaTab.AlphaTabApi) => void) => {
      const api = apiRef.current
      if (api) run(api)
    }
    const findTrack = (api: alphaTab.AlphaTabApi, index: number) =>
      api.score?.tracks.find((track) => track.index === index)
    const patchTrack = (index: number, partial: Partial<TrackInfo>) =>
      setState((s) => ({
        ...s,
        tracks: s.tracks.map((t) => (t.index === index ? { ...t, ...partial } : t)),
      }))

    /**
     * Starts playing selected bars from the bar before them, when that is
     * asked for. The range is only widened while playing, so everything else
     * goes on seeing the selection. Returns whether it took over the Play.
     */
    const startLeadIn = (api: alphaTab.AlphaTabApi): boolean => {
      const range = api.playbackRange
      const lookup = api.tickCache
      if (!stateRef.current.leadIn || !range || !lookup || leadIn.current) return false
      const first = leadInStart(lookup, range.startTick)
      if (first === null) return false
      if (startingPlay.current) return true
      startingPlay.current = true
      const selected = { startTick: range.startTick, endTick: range.endTick }
      const tick = api.tickPosition
      // Resumed partway through the selection it goes on from there, from the bar's start with a count-in.
      const inside = tick > selected.startTick + 4 && tick < selected.endTick
      const from = !inside ? first : api.countInVolume > 0 ? (barStartAt(lookup, tick) ?? tick) : tick
      leadIn.current = selected
      api.playbackRange = playbackRange({ startTick: first, endTick: selected.endTick })
      setState((s) => ({ ...s, currentTick: from }))
      void moveAndDraw(api, from).then(() => {
        startingPlay.current = false
        if (apiRef.current === api && leadIn.current === selected) api.play()
      })
      return true
    }

    return {
      load,
      /**
       * Shows an edited version of the song in place of the current one,
       * keeping the track shown, tempo, mute and solo, position and looping.
       * `firstChangedBar` lets alphaTab lay out only what changed.
       */
      replaceScore: (
        score: alphaTab.model.Score,
        trackIndex: number,
        firstChangedBar?: number,
        trackChange?: { kind: 'insert' | 'delete'; at: number } | null,
      ) =>
        withApi((api) => {
          const current = stateRef.current
          leadIn.current = null
          const exists = (index: number) => index < score.tracks.length
          // Mute and solo follow their tracks when a track is added or removed.
          const moved = (index: number): number | null => {
            if (!trackChange) return index
            if (trackChange.kind === 'insert') return index >= trackChange.at ? index + 1 : index
            if (index === trackChange.at) return null
            return index > trackChange.at ? index - 1 : index
          }
          const pick = (flag: 'muted' | 'solo') =>
            current.tracks
              .filter((t) => t[flag])
              .map((t) => moved(t.index))
              .filter((index): index is number => index !== null && exists(index))
          const volumes: Record<number, number> = {}
          for (const track of current.tracks) {
            const index = moved(track.index)
            if (index !== null && exists(index) && track.volume !== 1) volumes[index] = track.volume
          }
          pendingSettings.current = {
            speed: current.speed,
            trackIndex: exists(trackIndex) ? trackIndex : null,
            mutedTracks: pick('muted'),
            soloTracks: pick('solo'),
            volumes,
            pitch: current.pitch,
          }
          // A second edit can come before the first one's song is ready; the
          // position and selection to keep are still those from before the first.
          // The position shown is used rather than the player's, which reads
          // 0 while an edited song's MIDI is still being prepared.
          keepAfterEdit.current ??= {
            tick: current.currentTick,
            isLooping: api.isLooping,
            selection: selectedBars.current,
          }
          const selection = keepAfterEdit.current.selection
          restoreSelection.current = selection ? { ...selection, drawn: false, midi: false } : null
          api.renderScore(score, [exists(trackIndex) ? trackIndex : 0], {
            reuseViewport: true,
            firstChangedMasterBar: firstChangedBar,
          })
        }),
      /** Bars of the current selection, if any. */
      selection: () => selectedBars.current,
      dismissError: () => setState((s) => ({ ...s, error: null })),
      playPause: () =>
        withApi((api) => {
          prepareWorkletScope(api)
          const asleep = wakeAudio(api)
          // "Playing" with the audio asleep means nothing could be heard:
          // waking it is what the tap was for, not pausing.
          if (asleep && api.playerState === alphaTab.synth.PlayerState.Playing) return
          if (api.playerState === alphaTab.synth.PlayerState.Playing || api.countInVolume <= 0) {
            if (api.playerState === alphaTab.synth.PlayerState.Playing || !startLeadIn(api)) api.playPause()
            return
          }
          if (startLeadIn(api)) return
          // With a count-in, playback goes back to the start of the bar, as a practice take does.
          const from = countInStart(api)
          if (from === null) {
            api.playPause()
            return
          }
          if (startingPlay.current) return
          startingPlay.current = true
          setState((s) => ({ ...s, currentTick: from }))
          void moveAndDraw(api, from).then(() => {
            startingPlay.current = false
            if (apiRef.current === api && api.playerState !== alphaTab.synth.PlayerState.Playing) api.play()
          })
        }),
      stop: () =>
        withApi((api) => {
          api.stop()
          // While playing, the player's report of stopping does this.
          if (api.playerState !== alphaTab.synth.PlayerState.Playing) releaseLeadIn()
        }),
      releaseLeadIn,
      holdRange: (held: { range: { startTick: number; endTick: number } | null } | null) => {
        heldRange.current = held
      },
      seek: (tick: number) =>
        withApi((api) => {
          api.tickPosition = tick
          setState((s) => ({ ...s, currentTick: tick }))
        }),
      setSpeed: (speed: number) =>
        withApi((api) => {
          const next = clampSpeed(speed)
          api.playbackSpeed = next
          setState((s) => ({ ...s, speed: next }))
        }),
      /** Shifts the song by a number of semitones, to play it on a guitar tuned differently. */
      setPitch: (pitch: number) =>
        withApi((api) => {
          const next = clampPitch(pitch)
          if (api.score) applyPitch(api, api.score, next)
          setState((s) => ({ ...s, pitch: next }))
        }),
      showTrack: (index: number) =>
        withApi((api) => {
          const track = findTrack(api, index)
          if (!track) return
          // The selection is drawn on the beats of the track being left, which
          // alphaTab cannot find once another track is shown. It is taken off
          // and drawn again on the new track; the section to play stays as it is.
          const selection = selectedBars.current
          forgetHighlight(api, track)
          const profile = staveProfileFor(track, loadPrefs().showNotation)
          if (api.settings.display.staveProfile !== profile) {
            api.settings.display.staveProfile = profile
            api.updateSettings()
          }
          if (selection) {
            const redraw = () => {
              api.postRenderFinished.off(redraw)
              if (selectedBars.current !== selection || api.tracks[0] !== track) return
              const beats = barsBeats(track, selection.first, selection.last)
              if (beats) api.highlightPlaybackRange(beats.start, beats.end)
            }
            api.postRenderFinished.on(redraw)
          }
          api.renderTracks([track])
          setState((s) => ({ ...s, activeTrack: index }))
        }),
      setTrackMuted: (index: number, muted: boolean) =>
        withApi((api) => {
          const track = findTrack(api, index)
          if (!track) return
          api.changeTrackMute([track], muted)
          patchTrack(index, { muted })
        }),
      setTrackSolo: (index: number, solo: boolean) =>
        withApi((api) => {
          const track = findTrack(api, index)
          if (!track) return
          api.changeTrackSolo([track], solo)
          patchTrack(index, { solo })
        }),
      /** Volume of one track as a factor, 1 being as written. */
      setTrackVolume: (index: number, volume: number) =>
        withApi((api) => {
          const track = findTrack(api, index)
          if (!track) return
          const next = Math.min(MAX_VOLUME, Math.max(0, volume))
          api.changeTrackVolume([track], next)
          patchTrack(index, { volume: next })
        }),
      setMasterVolume: (volume: number) =>
        withApi((api) => {
          const next = Math.min(MAX_VOLUME, Math.max(0, volume))
          api.masterVolume = next
          savePrefs({ masterVolume: next })
          setState((s) => ({ ...s, masterVolume: next }))
        }),
      setLooping: (isLooping: boolean) =>
        withApi((api) => {
          api.isLooping = isLooping
          setState((s) => ({ ...s, isLooping }))
        }),
      clearLoopRange: () =>
        withApi((api) => {
          selectedBars.current = null
          leadIn.current = null
          api.playbackRange = null
          api.clearPlaybackRangeHighlight()
          setState((s) => ({ ...s, hasLoopRange: false }))
        }),
      /** Moves the playback position to the start of a bar. */
      jumpToBar: (bar: number) =>
        withApi((api) => {
          const tick = api.tickCache ? firstTickOfBar(api.tickCache, bar) : null
          if (tick === null) return
          api.tickPosition = tick
          // While playing, alphaTab follows the position itself.
          if (viewportRef.current && !stateRef.current.isPlaying) {
            scrollToPosition(api, viewportRef.current)
          }
          setState((s) => ({ ...s, currentTick: tick, currentBar: bar }))
        }),
      /** Selects a run of bars as the section to play, optionally repeating it. */
      selectBars: (firstBar: number, lastBar: number, loop: boolean) =>
        withApi((api) => {
          leadIn.current = null
          const beats = barsBeats(api.tracks[0], firstBar, Math.max(firstBar, lastBar))
          if (!beats) return
          selectedBars.current = { first: firstBar, last: Math.max(firstBar, lastBar) }
          api.highlightPlaybackRange(beats.start, beats.end)
          api.applyPlaybackRangeFromHighlight()
          // A bar of a single beat looks like "nothing selected" to alphaTab,
          // so its range is set from the bar's own ticks instead.
          if (beats.start === beats.end && api.tickCache) {
            const start = firstTickOfBar(api.tickCache, firstBar)
            const end = api.tickCache.masterBars.find((bar) => bar.masterBar.index === lastBar)?.end
            if (start !== null && end !== undefined) {
              api.playbackRange = playbackRange({ startTick: start, endTick: end })
            }
          }
          const tick = api.playbackRange?.startTick
          if (tick !== undefined) api.tickPosition = tick
          if (loop) api.isLooping = true
          setState((s) => ({
            ...s,
            isLooping: loop || s.isLooping,
            hasLoopRange: api.playbackRange !== null,
            currentTick: tick ?? s.currentTick,
            currentBar: firstBar,
          }))
        }),
      /** Brings the playback position into view. */
      revealPosition: () =>
        withApi((api) => {
          if (viewportRef.current) scrollToPosition(api, viewportRef.current)
        }),
      /** Starts choosing bars by tapping the first and then the last one. */
      startPicking: () => setPicking({ first: null }),
      cancelPicking: () => setPicking(null),
      setMetronome: (metronome: boolean) =>
        withApi((api) => {
          api.metronomeVolume = metronome ? 1 : 0
          savePrefs({ metronome })
          setState((s) => ({ ...s, metronome }))
        }),
      setCountIn: (countIn: boolean) =>
        withApi((api) => {
          api.countInVolume = countIn ? 1 : 0
          savePrefs({ countIn })
          setState((s) => ({ ...s, countIn }))
        }),
      setLeadIn: (on: boolean) => {
        savePrefs({ leadIn: on })
        if (!on) releaseLeadIn()
        setState((s) => ({ ...s, leadIn: on }))
      },
      setShowNotation: (showNotation: boolean) =>
        withApi((api) => {
          api.settings.display.staveProfile = staveProfileFor(api.tracks[0], showNotation)
          api.updateSettings()
          if (api.score) api.render()
          savePrefs({ showNotation })
          setState((s) => ({ ...s, showNotation }))
        }),
    }
  }, [load, releaseLeadIn])

  useEffect(() => {
    actionsRef.current = actions
  })

  return { state, actions, api, scoreRef, viewportRef, picking }
}

export type PlayerActions = ReturnType<typeof usePlayer>['actions']
