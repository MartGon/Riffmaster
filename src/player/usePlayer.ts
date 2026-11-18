import { debug, debugEnabled, describeError, installLevelMeter, level } from '../lib/debugLog'
import * as alphaTab from '@coderline/alphatab'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clampSpeed } from '../lib/format'
import { loadPrefs, MAX_VOLUME, savePrefs } from '../lib/prefs'
import { startOfflineStore } from '../lib/offline'
import type { SongSettings } from '../library/types'
import { snapSelectionToBars } from '../lib/loopRange'
import { listSections, type SongSection } from '../lib/sections'
import { barAtPoint } from './barAtPoint'
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
  showNotation: boolean
  /** Overall volume as a factor, 1 being full. */
  masterVolume: number
  /** Named parts of the song, as marked in the file. */
  sections: SongSection[]
  /** Bar the playback position is in, counted from 0. */
  currentBar: number
}

const initialState: PlayerState = {
  status: 'empty',
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
  showNotation: false,
  masterVolume: 1,
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

/** Index into the lookup's bars of the one being played at `tick`, searching outwards from `hint`. */
function lookupIndexAtTick(lookup: TickLookup, tick: number, hint: number): number {
  const bars = lookup.masterBars
  if (bars.length === 0) return -1
  let index = Math.min(Math.max(hint, 0), bars.length - 1)
  while (index > 0 && tick < bars[index].start) index--
  while (index < bars.length - 1 && tick >= bars[index].end) index++
  return index
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

/**
 * Wakes the audio up. iOS suspends or interrupts it when the page goes to
 * the background, the screen locks, or the audio mode changes (the
 * microphone opening and closing); it can only be resumed from a tap.
 * Returns whether it was asleep.
 */
const watchedContexts = new WeakSet<AudioContext>()

/** For the `?debug` log: the audio context's state, and its changes from now on. */
function audioState(api: alphaTab.AlphaTabApi): string {
  const context = audioContextOf(api)
  if (!context) return 'no context'
  if (!watchedContexts.has(context)) {
    watchedContexts.add(context)
    context.addEventListener('statechange', () => debug(`audio context -> ${context.state}`))
  }
  return `${context.state} @${context.sampleRate}Hz t=${context.currentTime.toFixed(2)}`
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
  context.audioWorklet
    .addModule(url)
    .then(
      () => debug('worklet scope prepared'),
      (error) => debug(`worklet scope could not be prepared: ${describeError(error)}`),
    )
    .finally(() => URL.revokeObjectURL(url))
}

/** For the `?debug` log: whether alphaTab has built its audio worklet, which it does on the first Play. */
function workletState(api: alphaTab.AlphaTabApi): string {
  const output = api.player?.output as { _worklet?: unknown } | undefined
  if (!output || !('_worklet' in output)) return 'script processor'
  return output._worklet ? 'worklet built' : 'no worklet yet'
}

let loggerHooked = false

/** Called when alphaTab could not set up the audio worklet that plays the song. */
const workletFailureListeners = new Set<() => void>()

/**
 * Watches alphaTab's log: its own warnings and errors go into the `?debug`
 * log, and a failed audio worklet is reported to the player, which alphaTab
 * itself only writes to the console.
 */
function hookAlphaTabLogger(): void {
  if (loggerHooked) return
  loggerHooked = true
  const previous = alphaTab.Logger.log
  const text = (details: unknown[]) => details.map((d) => (typeof d === 'string' ? d : describeError(d))).join(' ')
  alphaTab.Logger.log = {
    debug: (category, msg, ...details) => previous.debug(category, msg, ...details),
    info: (category, msg, ...details) => {
      debug(`alphaTab info [${category}] ${msg} ${text(details)}`)
      previous.info(category, msg, ...details)
    },
    warning: (category, msg, ...details) => {
      debug(`alphaTab warning [${category}] ${msg} ${text(details)}`)
      previous.warning(category, msg, ...details)
    },
    error: (category, msg, ...details) => {
      debug(`alphaTab error [${category}] ${msg} ${text(details)}`)
      previous.error(category, msg, ...details)
      if (category === 'WebAudio' && msg.startsWith('Audio Worklet operation failed')) {
        for (const listener of workletFailureListeners) listener()
      }
    },
  }
}

/**
 * With `?debug&output=sp`, plays through the older ScriptProcessor output
 * instead of an audio worklet, to tell apart problems with either.
 */
function debugOutputMode(): alphaTab.PlayerOutputMode | undefined {
  if (!debugEnabled()) return undefined
  return new URLSearchParams(window.location.search).get('output') === 'sp'
    ? alphaTab.PlayerOutputMode.WebAudioScriptProcessor
    : undefined
}

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
    installLevelMeter()
    const outputMode = debugOutputMode()
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
        ...(outputMode === undefined ? {} : { outputMode }),
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
    debug(`player created: output=${api.settings.player.outputMode} bank=${SOUND_BANK}`)
    api.player?.soundFontLoadFailed.on((error) => {
      debug(`sound bank failed: ${describeError(error)}`)
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
      debug(`alphaTab error: ${describeError(error)}`)
      // A failed sound download is handled above.
      if (error instanceof alphaTab.FileLoadError) return
      // A failed load leaves the previous score (if any) in place. alphaTab
      // logs the technical detail to the console.
      setState((s) => ({
        ...s,
        status: api.score ? 'ready' : 'empty',
        error:
          s.status === 'loading'
            ? 'This file could not be opened. It may be damaged or in a format that is not supported.'
            : error.message || 'Something went wrong.',
      }))
    })

    api.scoreLoaded.on((score) => {
      const settings = pendingSettings.current
      const speed = clampSpeed(settings?.speed ?? 1)
      const kept = keepAfterEdit.current
      api.playbackSpeed = speed
      api.isLooping = kept?.isLooping ?? false
      const wanted = settings?.trackIndex ?? null
      const first =
        wanted !== null && score.tracks.some((track) => track.index === wanted)
          ? wanted
          : defaultTrackIndex(score)
      const firstTrack = score.tracks.find((track) => track.index === first)
      // A selection belongs to the song it was made in. alphaTab keeps both
      // the section to play and the highlighted beats across a load, so
      // they are dropped here (see `showTrack` for the highlight).
      selectedBars.current = null
      api.playbackRange = null
      const anyBeat = firstTrack?.staves[0]?.bars[0]?.voices[0]?.beats[0]
      if (anyBeat) api.highlightPlaybackRange(anyBeat, anyBeat)
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
      const bars = api.tracks[0]?.staves[0]?.bars ?? []
      if (bars.length === 0) return
      const first = Math.min(wanted.first, bars.length - 1)
      const last = Math.min(wanted.last, bars.length - 1)
      const startBeat = bars[first].voices[0]?.beats[0]
      const endBeats = bars[last].voices[0]?.beats ?? []
      const endBeat = endBeats[endBeats.length - 1]
      if (!startBeat || !endBeat) return
      try {
        selectedBars.current = { first, last }
        // Applying a range moves the position to its start; keep where it was.
        const tick = api.tickPosition
        api.highlightPlaybackRange(startBeat, endBeat)
        api.applyPlaybackRangeFromHighlight()
        const range = api.playbackRange
        if (range && tick >= range.startTick && tick <= range.endTick) api.tickPosition = tick
      } catch (error) {
        // Losing the selection is better than breaking the player.
        console.warn('The selection could not be put back after an edit', error)
      }
    }
    const onDrawn = () => {
      if (!restoreSelection.current) return
      restoreSelection.current.drawn = true
      putBackSelection()
    }
    api.postRenderFinished.on(onDrawn)

    // Mute and solo live in the synthesizer, which is ready for the new
    // song once its MIDI data has been generated.
    api.midiLoaded.on(() => {
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
      if (!settings || !score) return
      const pick = (indexes: number[]) => score.tracks.filter((t) => indexes.includes(t.index))
      const muted = pick(settings.mutedTracks)
      const solo = pick(settings.soloTracks)
      if (muted.length > 0) api.changeTrackMute(muted, true)
      if (solo.length > 0) api.changeTrackSolo(solo, true)
      // Every track is set, including those at 100%: the synthesizer keeps
      // a channel's volume across loads, so an old value would linger.
      for (const track of score.tracks) {
        api.changeTrackVolume([track], settings.volumes?.[track.index] ?? 1)
      }
    })

    // Should alphaTab still fail to set up its audio worklet (see
    // prepareWorkletScope for the known cause), playback is started again a
    // few times, then the player says it could not start.
    let workletRetries = 0
    const retryAfterWorkletFailure = () => {
      if (workletRetries >= 3) {
        patch({ error: 'Playback could not start on this device. Reload the page to try again.' })
        return
      }
      workletRetries++
      window.setTimeout(() => {
        if (api.playerState !== alphaTab.synth.PlayerState.Playing) return
        debug(`starting playback again after the worklet failed (try ${workletRetries})`)
        api.pause()
        api.play()
      }, 100 * workletRetries)
    }
    workletFailureListeners.add(retryAfterWorkletFailure)

    let loggedLoad = false
    api.soundFontLoad.on((progress) => {
      if (!loggedLoad || progress.loaded === progress.total) debug(`sound bank ${progress.loaded}/${progress.total} bytes`)
      loggedLoad = true
      patch({ soundProgress: progress.total > 0 ? progress.loaded / progress.total : 0 })
    })
    api.playerReady.on(() => {
      prepareWorkletScope(api)
      debug(`player ready, audio ${audioState(api)}`)
      patch({ canPlay: true, soundProgress: 1 })
      startOfflineStore()
    })
    // Should the sounds never arrive, the rest of the app is still stored.
    const offlineTimer = window.setTimeout(startOfflineStore, 60000)
    // If playback is on but the position stops moving, the audio has been
    // cut off (on iOS, by the system). Playback is then paused, so the
    // button shows Play again and the next tap can wake the audio.
    let lastMove = 0
    let stallTimer = 0
    const watchStall = () => {
      window.clearInterval(stallTimer)
      lastMove = performance.now()
      stallTimer = window.setInterval(() => {
        if (api.playerState !== alphaTab.synth.PlayerState.Playing) {
          window.clearInterval(stallTimer)
          return
        }
        if (performance.now() - lastMove < 2500) return
        // A count-in does not move the position either; only audio that is
        // no longer running is a stall.
        if (audioContextOf(api)?.state === 'running') return
        window.clearInterval(stallTimer)
        api.pause()
        patch({ error: 'Playback stopped because the phone paused the sound. Press Play to go on.' })
      }, 500)
    }
    api.playerStateChanged.on((args) => {
      debug(`player state -> ${args.state === alphaTab.synth.PlayerState.Playing ? 'playing' : 'paused'}${args.stopped ? ' (stopped)' : ''}, audio ${audioState(api)}`)
      const playing = args.state === alphaTab.synth.PlayerState.Playing
      if (playing) watchStall()
      else window.clearInterval(stallTimer)
      patch({ isPlaying: playing })
    })
    api.playerPositionChanged.on(() => {
      lastMove = performance.now()
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
      if (args.playbackRange === null) selectedBars.current = null
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
  }, [])

  /** Loads a tab file's bytes and applies the song's remembered settings. */
  const load = useCallback((data: ArrayBuffer, settings: SongSettings) => {
    const api = apiRef.current
    if (!api) return
    api.stop()
    keepAfterEdit.current = null
    restoreSelection.current = null
    // A new song starts without a half-made choice of bars.
    setPicking(null)
    pendingSettings.current = settings
    setState((s) => ({ ...s, status: 'loading', error: null }))
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
          debug(`play tapped: ready=${api.isReadyForPlayback} state=${api.playerState} audio ${audioState(api)}`)
          window.setTimeout(() => debug(`  0.5 s later: state=${api.playerState} tick=${api.tickPosition} audio ${audioState(api)}, ${workletState(api)}, ${level()}`), 500)
          window.setTimeout(() => debug(`  2 s later: state=${api.playerState} tick=${api.tickPosition} audio ${audioState(api)}, ${workletState(api)}, ${level()}`), 2000)
          prepareWorkletScope(api)
          const asleep = wakeAudio(api)
          // "Playing" with the audio asleep means nothing could be heard:
          // waking it is what the tap was for, not pausing.
          if (asleep && api.playerState === alphaTab.synth.PlayerState.Playing) return
          api.playPause()
        }),
      stop: () => withApi((api) => api.stop()),
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
      showTrack: (index: number) =>
        withApi((api) => {
          const track = findTrack(api, index)
          if (!track) return
          // The selection is drawn on the beats of the track being left, which
          // alphaTab cannot find once another track is shown. It is taken off
          // and drawn again on the new track; the section to play stays as it is.
          const selection = selectedBars.current
          // alphaTab has no call that forgets the highlighted beats; pointing
          // both ends at one beat is what it treats as "nothing highlighted".
          const anyBeat = track.staves[0]?.bars[0]?.voices[0]?.beats[0]
          if (anyBeat) api.highlightPlaybackRange(anyBeat, anyBeat)
          const profile = staveProfileFor(track, loadPrefs().showNotation)
          if (api.settings.display.staveProfile !== profile) {
            api.settings.display.staveProfile = profile
            api.updateSettings()
          }
          if (selection) {
            const redraw = () => {
              api.postRenderFinished.off(redraw)
              if (selectedBars.current !== selection || api.tracks[0] !== track) return
              const bars = track.staves[0]?.bars
              const startBeat = bars?.[selection.first]?.voices[0]?.beats[0]
              const endBeats = bars?.[selection.last]?.voices[0]?.beats
              const endBeat = endBeats?.[endBeats.length - 1]
              if (startBeat && endBeat) api.highlightPlaybackRange(startBeat, endBeat)
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
          const bars = api.tracks[0]?.staves[0]?.bars
          const startBeat = bars?.[firstBar]?.voices[0]?.beats[0]
          const endBeats = bars?.[Math.max(firstBar, lastBar)]?.voices[0]?.beats
          const endBeat = endBeats?.[endBeats.length - 1]
          if (!startBeat || !endBeat) return
          selectedBars.current = { first: firstBar, last: Math.max(firstBar, lastBar) }
          api.highlightPlaybackRange(startBeat, endBeat)
          api.applyPlaybackRangeFromHighlight()
          // A bar of a single beat looks like "nothing selected" to alphaTab,
          // so its range is set from the bar's own ticks instead.
          if (startBeat === endBeat && api.tickCache) {
            const start = firstTickOfBar(api.tickCache, firstBar)
            const end = api.tickCache.masterBars.find((bar) => bar.masterBar.index === lastBar)?.end
            if (start !== null && end !== undefined) {
              api.playbackRange = { startTick: start, endTick: end } as typeof api.playbackRange
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
      setShowNotation: (showNotation: boolean) =>
        withApi((api) => {
          api.settings.display.staveProfile = staveProfileFor(api.tracks[0], showNotation)
          api.updateSettings()
          if (api.score) api.render()
          savePrefs({ showNotation })
          setState((s) => ({ ...s, showNotation }))
        }),
    }
  }, [load])

  useEffect(() => {
    actionsRef.current = actions
  })

  return { state, actions, api, scoreRef, viewportRef, picking }
}

export type PlayerActions = ReturnType<typeof usePlayer>['actions']
