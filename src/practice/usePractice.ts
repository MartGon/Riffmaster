import * as alphaTab from '@coderline/alphatab'
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TakeRecord } from '../library/types'
import { isDark, onThemeChange } from '../lib/theme'
import type { PlayerState } from '../player/usePlayer'
import { defaultDetectorOptions, type DetectedNote, NoteDetector } from './detector'
import {
  type CalibrationMode,
  loadPracticeSettings,
  type PracticeSettings,
  savePracticeSettings,
} from './deviceSettings'
import { buildTimeMap, collectExpected, type TabNote } from './expectedNotes'
import type { Mark } from './grades'
import { MIN_NOTES_TO_RECORD, tallyBars } from './history'
import { colourNotes, MarkLayer } from './marks'
import {
  estimateLatency,
  isScored,
  matchNotes,
  matchOptionsFor,
  type NoteGrade,
  type PlayedNote,
  type PracticeSummary,
  summarize,
  type TimingLeeway,
} from './matching'
import { type InputDevice, listInputs, MicInput } from './micInput'
import { downloadFile, encodeTake } from './takeFile'
import { describeTake, inputLevel, readTakeReport, type TakeDetails } from './takeReport'
import { trainerOutcome, type TrainerSettings } from './trainer'

export type TakeKind = 'practice' | 'measure'

export interface PracticeResult {
  summary: PracticeSummary
  /** Delay between tab and microphone used for scoring, in ms. */
  latencyMs: number
  /** Where that delay came from. */
  latencySource: 'measured' | 'estimated' | 'remembered' | 'none'
}

/** What a finished take adds to the song's practice history. */
export type NewTake = Omit<TakeRecord, 'id' | 'songId' | 'at'>

export interface PracticeOptions {
  setSpeed: (speed: number) => void
  /** Called with every finished take that is worth remembering. */
  onTake: (take: NewTake) => void
}

export interface TrainerState extends TrainerSettings {
  /** True from the first round until the trainer finishes or is stopped, including the pauses between rounds. */
  running: boolean
  round: number
  /** How the last round went and what comes next, in words. */
  status: string | null
}

export interface PracticeState {
  /** Whether the practice panel is showing. */
  open: boolean
  phase: 'idle' | 'starting' | 'recording' | 'results'
  kind: TakeKind
  error: string | null
  /** Outcome of the last delay measurement, in words. */
  notice: string | null
  micReady: boolean
  inputs: InputDevice[]
  inputId: string | null
  /** Input level from 0 to 1, for the meter. */
  level: number
  mode: CalibrationMode
  /** Measured delay for the current input, if it has been measured. */
  measuredMs: number | null
  live: { hit: number; total: number } | null
  result: PracticeResult | null
  /** Whether notes in the tab are currently coloured with results. */
  marked: boolean
  /** Whether results are marked on the notes while the song is still playing. */
  liveMarks: boolean
  trainer: TrainerState
  /** How strictly timing is judged. */
  leeway: TimingLeeway
  /**
   * While practising with Loop on: each pass round the loop is scored on its
   * own. Accuracy of every finished pass of the current take, oldest first.
   */
  passes: number[]
  /** Number of the pass being played, from 1; 0 when not looping. */
  pass: number
  /** Whether the last take's recording is still held and can be saved to a file. */
  canSave: boolean
}

const initialState: PracticeState = {
  open: false,
  phase: 'idle',
  kind: 'practice',
  error: null,
  notice: null,
  micReady: false,
  inputs: [],
  inputId: null,
  level: 0,
  mode: 'auto',
  measuredMs: null,
  live: null,
  result: null,
  marked: false,
  liveMarks: true,
  trainer: { enabled: false, threshold: 0.9, step: 0.05, running: false, round: 0, status: null },
  leeway: 'normal',
  passes: [],
  pass: 0,
  canSave: false,
}

const percent = (share: number) => `${Math.round(share * 100)}%`

/** Pause between two rounds of the speed trainer, in ms. */
const TRAINER_PAUSE_MS = 2500
/** Ticks (960 to a quarter note) the reported playback position may be past the real one. */
const POSITION_SLACK = 2
/** Longest stretch of input kept for saving a take, in seconds. */
const MAX_SAVED_SEC = 600

/**
 * One run through the notes of a take. A take is one pass, unless Loop is on:
 * then playback jumps back at the end of the section, the song's clock jumps
 * back with it, and every time round is scored as a pass of its own.
 */
interface Pass {
  number: number
  /** Samples of (page clock − song clock), one per player position update. */
  anchors: number[]
  /** Furthest point of the song reached in this pass, in ms. */
  reachedMs: number
  /** Page time at which the pass began and ended, for picking out the notes heard during it. */
  startedAt: number
  endedAt: number | null
  /** Set once the pass has been scored. */
  done: boolean
  /** Waits for the pass's last notes before scoring it. */
  timer: number | null
}

/** What a scored pass left behind, for showing once the take is over. */
interface PassOutcome {
  result: PracticeResult
  grades: Map<alphaTab.model.Note, NoteGrade>
}

interface Take {
  kind: TakeKind
  trackIndex: number
  /** Strings on the practised track, so the report can number them as players do. */
  strings: number
  expected: TabNote[]
  played: DetectedNote[]
  detector: NoteDetector
  /** The input as it was heard, kept so the take can be saved for troubleshooting. */
  audio: Float32Array[]
  audioSamples: number
  /** What the last scoring made of the take, for the same purpose. */
  report: (() => Record<string, unknown>) | null
  /** Position in the microphone's audio at which this take's detector started, in seconds. */
  micStartSec: number | null
  passes: Pass[]
  /** Whether playback loops over `range`, making a new pass each time round. */
  looping: boolean
  /** The ticks the take plays, from where it started to where it ends. */
  range: { startTick: number; endTick: number }
  /** How long one time round the loop takes, in ms at the take's speed. */
  loopMs: number
  /** The latest scored pass, kept for the end of a looped take. */
  lastOutcome: PassOutcome | null
  speed: number
  sawPlaying: boolean
  /** Set when the player ended the take by hand rather than by reaching the end. */
  userStopped: boolean
  /** Set once playback has stopped and the take is only waiting for its last notes. */
  ending: boolean
  /** Timer for that wait. */
  tailTimer: number | null
  cleanup: () => void
}

function newPass(number: number): Pass {
  return { number, anchors: [], reachedMs: 0, startedAt: performance.now(), endedAt: null, done: false, timer: null }
}

/** Page time to wait after a pass for its last notes to arrive through headphones and microphone. */
function tailWaitMs(latencyMs: number): number {
  return Math.min(1200, Math.max(300, latencyMs + 250))
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function describeMicError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access was blocked. Allow it for this site in your browser settings, then try again.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone or audio input was found.'
  }
  if (name === 'NotReadableError') {
    return 'The audio input is in use by another app.'
  }
  return 'Could not open the audio input.'
}

/**
 * Resolves once the player has stopped and moved to `tick` and alphaTab has
 * drawn the cursor there, which it does on the frames after the player
 * reports the move. Gives up waiting after a moment, should no report come.
 */
function seekSettled(api: alphaTab.AlphaTabApi, tick: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    let stopped = false
    const settle = () => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      api.playerStateChanged.off(onState)
      api.playerPositionChanged.off(onMove)
      // Two frames on, the cursor is in place.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }
    // The player reports its stop before the move, and other moves come and
    // go meanwhile; only the move reported after the stop is the one asked for.
    // alphaTab hands a new listener the current state and position at once;
    // those are not reports of this stop and move.
    let listening = false
    const onState = (args: { state: number }) => {
      if (listening && args.state !== alphaTab.synth.PlayerState.Playing) stopped = true
    }
    const onMove = (args: { isSeek: boolean; currentTick: number }) => {
      if (listening && stopped && args.isSeek && Math.abs(args.currentTick - tick) < 5) settle()
    }
    const timer = window.setTimeout(settle, 500)
    api.playerStateChanged.on(onState)
    api.playerPositionChanged.on(onMove)
    listening = true
  })
}

/**
 * Practice mode: listens to the instrument while the song plays, matches
 * what it hears against the shown track, and reports accuracy and timing.
 */
export function usePractice(
  api: alphaTab.AlphaTabApi | null,
  player: PlayerState,
  /** Element laid over the score, in which result marks are drawn. */
  marksRef: RefObject<HTMLElement | null>,
  options: PracticeOptions,
) {
  const [state, setState] = useState<PracticeState>(() => {
    const settings = loadPracticeSettings()
    return {
      ...initialState,
      mode: settings.mode,
      liveMarks: settings.liveMarks,
      leeway: settings.leeway,
      trainer: { ...initialState.trainer, ...settings.trainer },
    }
  })
  const layerRef = useRef<MarkLayer | null>(null)
  /** The speed trainer's progress; `timer` is set during the pause between rounds. */
  const trainerRef = useRef<{
    running: boolean
    round: number
    timer: number | null
    /** The ticks round 1 played, so later rounds play the same notes. */
    range?: { startTick: number; endTick: number }
  }>({
    running: false,
    round: 0,
    timer: null,
  })
  const optionsRef = useRef(options)
  const micRef = useRef<MicInput | null>(null)
  const takeRef = useRef<Take | null>(null)
  /** The last finished practice take, held until the next one starts. */
  const savedRef = useRef<Take | null>(null)
  const markedRef = useRef<Map<alphaTab.model.Note, Mark>>(new Map())
  const lastLevelAt = useRef(0)
  /** Counts microphone open and close requests, so a slow open can tell it was superseded. */
  const micRequest = useRef(0)
  // The latest player state, readable from event handlers without re-subscribing.
  const playerRef = useRef(player)
  // alphaTab is driven imperatively, so it is reached through a ref as well.
  const apiRef = useRef(api)
  useEffect(() => {
    playerRef.current = player
    apiRef.current = api
    optionsRef.current = options
  })

  // The layer of result marks follows the score: it is redrawn whenever
  // the score is laid out again (resize, another track, notation on or off).
  useEffect(() => {
    const element = marksRef.current
    if (!api || !element) return
    const layer = new MarkLayer(element, api)
    layerRef.current = layer
    const redraw = () => layer.redraw()
    api.postRenderFinished.on(redraw)
    return () => {
      api.postRenderFinished.off(redraw)
      layer.clear()
      layerRef.current = null
    }
  }, [api, marksRef])

  const patch = useCallback((partial: Partial<PracticeState>) => {
    setState((s) => ({ ...s, ...partial }))
  }, [])

  const updateSettings = useCallback((change: (settings: PracticeSettings) => void) => {
    const settings = loadPracticeSettings()
    change(settings)
    savePracticeSettings(settings)
    return settings
  }, [])

  const clearMarks = useCallback(() => {
    layerRef.current?.clear()
    if (markedRef.current.size === 0) return
    for (const note of markedRef.current.keys()) note.style = undefined
    markedRef.current.clear()
    if (api?.score) api.render()
    patch({ marked: false })
  }, [api, patch])

  /** Colours the marked notes in the tab for the current light or dark theme. */
  const paintMarked = useCallback(() => {
    colourNotes(markedRef.current, isDark())
  }, [])

  // The result colours differ between the light and the dark theme.
  useEffect(() => {
    return onThemeChange(() => {
      if (markedRef.current.size === 0) return
      paintMarked()
      if (apiRef.current?.score) apiRef.current.render()
    })
  }, [paintMarked])

  const closeMic = useCallback(() => {
    micRequest.current++
    micRef.current?.close()
    micRef.current = null
  }, [])

  const openMic = useCallback(
    async (deviceId: string | null): Promise<MicInput | null> => {
      closeMic()
      const request = micRequest.current
      try {
        let mic: MicInput
        try {
          mic = await MicInput.open(deviceId)
        } catch (error) {
          // A remembered device that has been unplugged: fall back to the default input.
          if (!deviceId || !(error instanceof DOMException) || error.name !== 'OverconstrainedError') {
            throw error
          }
          mic = await MicInput.open(null)
        }
        // The panel may have been closed, or another input chosen, while the
        // browser was still asking for permission.
        if (request !== micRequest.current) {
          mic.close()
          return null
        }
        micRef.current = mic
        mic.onBlock = (block) => {
          const take = takeRef.current
          if (take) {
            take.micStartSec ??= block.frame / mic.sampleRate
            take.detector.feed(block.samples)
            if (take.audioSamples < MAX_SAVED_SEC * mic.sampleRate) {
              take.audio.push(block.samples)
              take.audioSamples += block.samples.length
            }
          }
          const now = performance.now()
          if (now - lastLevelAt.current > 90) {
            lastLevelAt.current = now
            let peak = 0
            for (let i = 0; i < block.samples.length; i++) {
              const value = Math.abs(block.samples[i])
              if (value > peak) peak = value
            }
            setState((s) => (Math.abs(s.level - peak) > 0.01 ? { ...s, level: peak } : s))
          }
        }
        const inputs = await listInputs()
        const settings = updateSettings((s) => {
          s.inputId = mic.deviceId || null
        })
        patch({
          micReady: true,
          error: null,
          inputs,
          inputId: mic.deviceId || null,
          measuredMs: settings.measured[mic.deviceId] ?? null,
        })
        return mic
      } catch (error) {
        patch({ micReady: false, error: describeMicError(error) })
        return null
      }
    },
    [closeMic, patch, updateSettings],
  )

  /**
   * Scores what has been heard against the notes the take has reached, and
   * returns the part belonging to one pass. All passes of a loop are laid
   * end to end on one timeline and matched together, so every heard note
   * counts at most once, however close it is to the turn of the loop.
   * `final` says that playback is over; otherwise the newest notes, whose
   * sound may not have arrived yet, are left out.
   */
  const score = useCallback((take: Take, pass: Pass, mic: MicInput, final: boolean) => {
    const own = take.passes.indexOf(pass)
    // (page clock − song clock) per pass. A pass that has only just begun
    // borrows the one before it, moved on by one time round the loop.
    const anchors: (number | null)[] = []
    take.passes.forEach((item, index) => {
      const previous = index > 0 ? anchors[index - 1] : null
      anchors.push(
        item.anchors.length > 0 ? median(item.anchors) : previous !== null ? previous + take.loopMs : null,
      )
    })
    if (own < 0 || anchors[own] === null || anchors[0] === null) return null
    const last = take.passes.length - 1
    // Each turn of a loop takes a little longer than written (alphaTab
    // pauses briefly at the jump), so passes are placed on the timeline by
    // when they actually played, measured against the first one.
    const base = anchors[0]
    const shift = anchors.map((anchor) => (anchor === null ? null : anchor - base))

    const settings = loadPracticeSettings()
    const measured = settings.measured[mic.deviceId]
    const options = matchOptionsFor(settings.leeway)

    // The notes every pass has reached, on the shared timeline.
    const timeline: { note: TabNote; pass: number; timeMs: number; midi: number[] }[] = []
    take.passes.forEach((item, index) => {
      const offset = shift[index]
      if (offset === null) return
      for (const note of take.expected) {
        if (note.timeMs > item.reachedMs) continue
        timeline.push({ note, pass: index, timeMs: note.timeMs + offset, midi: note.midi })
      }
    })
    // Heard notes, on the first pass's clock.
    const micStart = take.micStartSec ?? 0
    const played: PlayedNote[] = take.played.map((note) => ({
      timeMs: mic.toPageTimeMs(micStart + note.timeSec) - base,
      midi: note.midi,
      // Filled in a moment after the note itself; needed to score chords.
      present: note.present,
    }))

    const estimate = estimateLatency(timeline, played, {
      preferMs: measured ?? settings.learned[mic.deviceId],
    })
    let latencyMs = 0
    let latencySource: PracticeResult['latencySource'] = 'none'
    if (take.kind === 'practice' && settings.mode === 'measured' && measured !== undefined) {
      latencyMs = measured
      latencySource = 'measured'
    } else if (estimate) {
      latencyMs = estimate.latencyMs
      latencySource = 'estimated'
    } else if (settings.learned[mic.deviceId] !== undefined) {
      latencyMs = settings.learned[mic.deviceId]
      latencySource = 'remembered'
    }
    // While still playing, the newest notes of the pass under way wait for their sound.
    const latest = take.passes[last].reachedMs + (shift[last] ?? 0)
    const horizon = final ? Number.POSITIVE_INFINITY : latest - 250 - Math.max(0, latencyMs)
    const scored = timeline.filter((entry) => entry.pass < last || entry.timeMs <= horizon)
    const { results, usedPlayed } = matchNotes(scored, played, latencyMs, options)

    const expected: TabNote[] = []
    const ownResults: typeof results = []
    scored.forEach((entry, index) => {
      if (entry.pass !== own) return
      expected.push(entry.note)
      ownResults.push(results[index])
    })
    // Wrong or extra notes of this pass: unmatched ones heard within its notes.
    let extraNotes = 0
    if (expected.length > 0) {
      const offset = shift[own] ?? 0
      const from = expected[0].timeMs + offset - options.windowMs
      const to = expected[expected.length - 1].timeMs + offset + options.windowMs
      played.forEach((note, index) => {
        const at = note.timeMs - latencyMs
        if (!usedPlayed.has(index) && at >= from && at <= to) extraNotes++
      })
    }
    // Everything needed to see afterwards why a note was or was not counted.
    // `wavSec` places a note in the saved recording.
    const wavSec = (timeMs: number) => mic.fromPageTimeMs(timeMs + base) - micStart
    take.report = () => ({
      sampleRate: mic.sampleRate,
      input: { label: mic.label, settings: mic.trackSettings },
      savedSec: take.audioSamples / mic.sampleRate,
      speed: take.speed,
      looping: take.looping,
      loopMs: take.loopMs,
      passes: take.passes.length,
      leeway: settings.leeway,
      match: options,
      detector: defaultDetectorOptions,
      latencyMs,
      latencySource,
      latencySupport: estimate?.support ?? null,
      measuredMs: measured ?? null,
      learnedMs: settings.learned[mic.deviceId] ?? null,
      strings: take.strings,
      expected: scored.map((entry, index) => ({
        pass: entry.pass,
        bar: entry.note.bar,
        tick: entry.note.tick,
        midi: entry.midi,
        places: entry.note.notes.map((note) => ({ string: note.string, fret: note.fret })),
        timeMs: entry.timeMs,
        // Where its sound should be in the recording, the delay included.
        wavSec: wavSec(entry.timeMs + latencyMs),
        grade: results[index].grade,
        offsetMs: results[index].offsetMs,
      })),
      heard: played.map((note, index) => ({
        wavSec: take.played[index].timeSec,
        timeMs: note.timeMs,
        midi: note.midi,
        present: note.present,
        matched: usedPlayed.has(index),
      })),
    })
    if (process.env.NODE_ENV === 'development') {
      // Lets automated checks see what was heard and how it lined up.
      ;(window as unknown as { __riffmasterTake?: unknown }).__riffmasterTake = {
        played,
        expected: expected.map((note) => ({ timeMs: note.timeMs + (shift[own] ?? 0), midi: note.midi })),
        latencyMs,
        latencySource,
        anchors: pass.anchors.length,
        passes: take.passes.length,
        // The whole timeline, for checking how a loop's passes line up.
        loopMs: take.loopMs,
        passAnchors: anchors,
        passStarts: take.passes.map((item) => item.startedAt),
        timeline: scored.map((entry, index) => ({
          pass: entry.pass,
          timeMs: entry.timeMs,
          midi: entry.midi,
          grade: results[index].grade,
          offsetMs: results[index].offsetMs,
        })),
      }
    }
    return { expected, results: ownResults, extraNotes, latencyMs, latencySource, estimate }
  }, [])

  /** Ends the speed trainer, cancelling a round that is waiting to start. */
  const endTrainer = useCallback((status: string | null) => {
    const run = trainerRef.current
    if (run.timer !== null) window.clearTimeout(run.timer)
    trainerRef.current = { running: false, round: 0, timer: null }
    setState((s) =>
      s.trainer.running || s.trainer.status !== status
        ? { ...s, trainer: { ...s.trainer, running: false, round: 0, status } }
        : s,
    )
  }, [])

  // `start` and `complete` call each other across the pause between trainer rounds.
  const startRef = useRef<(kind: TakeKind, nextRound?: boolean) => Promise<void>>(async () => {})

  /** Drops a take without scoring it. */
  const abortTake = useCallback(() => {
    endTrainer(null)
    const take = takeRef.current
    if (!take) return
    takeRef.current = null
    if (take.tailTimer !== null) window.clearTimeout(take.tailTimer)
    for (const pass of take.passes) if (pass.timer !== null) window.clearTimeout(pass.timer)
    if (!take.ending) take.cleanup()
  }, [endTrainer])

  /**
   * Scores a finished pass: remembers the delay it found, adds it to the
   * practice history, and keeps its grades for showing later.
   */
  const evaluate = useCallback(
    (take: Take, pass: Pass, mic: MicInput, final: boolean) => {
      const scored = score(take, pass, mic, final)
      if (!scored || scored.expected.filter(isScored).length === 0) return null
      if (scored.latencySource === 'estimated' && scored.estimate && scored.estimate.support >= 8) {
        const learned = Math.round(scored.estimate.latencyMs)
        updateSettings((s) => {
          s.learned[mic.deviceId] = learned
        })
      }
      // A note that is played more than once (repeats) shows its worst result.
      const rank: NoteGrade[] = ['onTime', 'early', 'late', 'missed']
      const grades = new Map<alphaTab.model.Note, NoteGrade>()
      scored.expected.forEach((note, index) => {
        const grade = scored.results[index].grade
        if (grade === 'unscored') return
        for (const tabNote of note.notes) {
          const previous = grades.get(tabNote)
          if (!previous || rank.indexOf(grade) > rank.indexOf(previous)) grades.set(tabNote, grade)
        }
      })
      const summary = summarize(scored.results, scored.extraNotes)
      // A take in which nothing was heard is not practice, just a run-through.
      if (summary.scored >= MIN_NOTES_TO_RECORD && summary.hit > 0) {
        const bars = scored.expected.map((note) => note.bar)
        optionsRef.current.onTake({
          trackIndex: take.trackIndex,
          speed: take.speed,
          startBar: Math.min(...bars),
          endBar: Math.max(...bars),
          scored: summary.scored,
          onTime: summary.onTime,
          early: summary.early,
          late: summary.late,
          missed: summary.missed,
          accuracy: summary.accuracy,
          bars: tallyBars(bars, scored.results),
          trainer: trainerRef.current.running,
        })
      }
      const outcome: PassOutcome = {
        result: { summary, latencyMs: Math.round(scored.latencyMs), latencySource: scored.latencySource },
        grades,
      }
      take.lastOutcome = outcome
      return outcome
    },
    [score, updateSettings],
  )

  /** Scores a pass of a looped take once its last notes have had time to arrive. */
  const completePass = useCallback(
    (take: Take, pass: Pass) => {
      if (pass.done) return
      pass.done = true
      pass.timer = null
      const mic = micRef.current
      // The next pass is still playing.
      const outcome = mic ? evaluate(take, pass, mic, false) : null
      if (!outcome) return
      setState((s) => ({
        ...s,
        passes: [...s.passes, outcome.result.summary.accuracy],
        result: outcome.result,
      }))
    },
    [evaluate],
  )

  const complete = useCallback((take: Take) => {
    if (takeRef.current !== take) return
    const mic = micRef.current
    takeRef.current = null
    take.detector.flush()
    const last = take.passes[take.passes.length - 1]
    last.endedAt ??= performance.now()

    if (take.kind === 'measure') {
      const scored = mic ? score(take, last, mic, true) : null
      layerRef.current?.clear()
      if (!mic || !scored?.estimate || scored.estimate.support < 5) {
        patch({
          phase: 'idle',
          live: null,
          notice:
            'Could not hear the track clearly enough to measure the delay. Hold the earbud right against the microphone, turn the volume up, and try again.',
        })
        return
      }
      const latencyMs = Math.round(scored.estimate.latencyMs)
      updateSettings((s) => {
        s.measured[mic.deviceId] = latencyMs
        s.mode = 'measured'
      })
      patch({
        phase: 'idle',
        live: null,
        mode: 'measured',
        measuredMs: latencyMs,
        notice: `Measured a delay of ${latencyMs} ms for this input.`,
      })
      return
    }

    // Passes of a loop still waiting for their last notes are scored now.
    for (const pass of take.passes) {
      if (pass === last || pass.done) continue
      if (pass.timer !== null) window.clearTimeout(pass.timer)
      completePass(take, pass)
    }
    last.done = true
    // In a loop, the pass that Stop cut short is left out: the passes before
    // it are complete, and a few notes into a new pass are not a result.
    const cutShort = take.looping && take.passes.length > 1
    const outcome = mic && !cutShort ? evaluate(take, last, mic, true) : null
    // A loop stopped just after starting a new pass shows the pass before.
    const shown = outcome ?? take.lastOutcome
    if (!shown) {
      layerRef.current?.clear()
      endTrainer(null)
      patch({
        phase: 'idle',
        live: null,
        pass: 0,
        notice: 'The take ended before any notes were due, so there is nothing to score.',
      })
      return
    }
    savedRef.current = take.report && take.audioSamples > 0 ? take : null
    // Colour the notes in the tab.
    const marks = new Map<alphaTab.model.Note, Mark>()
    for (const [tabNote, grade] of shown.grades) {
      markedRef.current.set(tabNote, grade as Mark)
      marks.set(tabNote, grade as Mark)
    }
    paintMarked()
    layerRef.current?.set(marks)
    // Drawing the score again also puts the marks back in place.
    if (api?.score && shown.grades.size > 0) api.render()
    setState((s) => ({
      ...s,
      phase: 'results',
      live: null,
      pass: 0,
      marked: shown.grades.size > 0,
      result: shown.result,
      canSave: savedRef.current !== null,
      passes: take.looping && outcome ? [...s.passes, outcome.result.summary.accuracy] : s.passes,
    }))

    const run = trainerRef.current
    if (!run.running) return
    if (take.userStopped || !outcome) {
      endTrainer(null)
      return
    }
    const summary = outcome.result.summary
    const trainer = loadPracticeSettings().trainer
    const result = trainerOutcome(take.speed, summary.accuracy, trainer)
    if (result.finished) {
      endTrainer(`Trainer finished: you passed at ${percent(take.speed)} of the written tempo.`)
      return
    }
    if (result.nextSpeed !== take.speed) optionsRef.current.setSpeed(result.nextSpeed)
    const status = result.passed
      ? `Round ${run.round} passed. Next round at ${percent(result.nextSpeed)} tempo.`
      : `Round ${run.round}: ${percent(summary.accuracy)} is below the ${percent(trainer.threshold)} target. Same tempo again.`
    run.round++
    run.timer = window.setTimeout(() => {
      run.timer = null
      void startRef.current('practice', true)
    }, TRAINER_PAUSE_MS)
    setState((s) => ({ ...s, trainer: { ...s.trainer, running: true, round: run.round, status } }))
  }, [api, completePass, endTrainer, evaluate, paintMarked, patch, score, updateSettings])

  /**
   * Ends the take once playback has stopped. Scoring waits a moment first:
   * the last notes played are still on their way through the headphones and
   * the microphone, and would otherwise be reported as missed.
   */
  const finish = useCallback(() => {
    const take = takeRef.current
    if (!take || take.ending) return
    take.ending = true
    take.cleanup()
    const mic = micRef.current
    const pass = take.passes[take.passes.length - 1]
    pass.endedAt = performance.now()
    const delaySoFar = mic ? (score(take, pass, mic, false)?.latencyMs ?? 0) : 0
    take.tailTimer = window.setTimeout(() => complete(take), tailWaitMs(delaySoFar))
  }, [complete, score])

  const start = useCallback(
    async (kind: TakeKind, nextRound = false) => {
      const api = apiRef.current
      if (!api?.score || takeRef.current) return
      // A press of Start begins a fresh run; the trainer's own rounds carry on with theirs.
      if (!nextRound) endTrainer(null)
      const current = playerRef.current
      const lookup = api.tickCache
      const track = api.score.tracks.find((t) => t.index === current.activeTrack)
      if (!lookup || !track) {
        endTrainer(null)
        return
      }
      if (track.staves[0]?.isPercussion) {
        endTrainer(null)
        patch({ error: 'Practice mode listens for pitched notes, so it cannot score a drum track.' })
        return
      }
      // The take covers the selected bars, or runs from the playback
      // position to the end. A position at the very end starts over.
      const songEnd = lookup.masterBars[lookup.masterBars.length - 1]?.end ?? 0
      const selected = api.playbackRange
      // The player reports a position one tick later than the one it was
      // given, so a note exactly at the position would be left out: the
      // first note of a tab, or of the bar that was jumped to.
      let startTick = selected ? selected.startTick : Math.max(0, api.tickPosition - POSITION_SLACK)
      if (!selected && startTick >= songEnd - 1 - POSITION_SLACK) startTick = 0
      // Later rounds of the speed trainer play what round 1 played.
      const kept = nextRound ? trainerRef.current.range : undefined
      const range = kept ?? { startTick, endTick: selected ? selected.endTick : songEnd }
      // Read from the player itself: the trainer may have changed the speed a moment ago.
      const speed = api.playbackSpeed
      const expected = collectExpected(lookup, track.index, speed, range)
      const timeAt = buildTimeMap(lookup)
      if (expected.filter(isScored).length === 0) {
        endTrainer(null)
        patch({
          error: selected
            ? 'There are no single notes to score for this track in the selected section.'
            : 'There are no single notes to score for this track from the playback position on.',
        })
        return
      }
      const settings = loadPracticeSettings()
      if (kind === 'practice' && !nextRound && settings.trainer.enabled) {
        trainerRef.current = { running: true, round: 1, timer: null, range }
        setState((s) => ({ ...s, trainer: { ...s.trainer, running: true, round: 1, status: null } }))
      }
      // With Loop on, practice goes round the section until stopped. The
      // speed trainer has rounds of its own instead.
      const looping = kind === 'practice' && current.isLooping && !trainerRef.current.running
      patch({
        phase: 'starting',
        kind,
        error: null,
        notice: null,
        result: null,
        live: null,
        passes: [],
        pass: looping ? 1 : 0,
        canSave: false,
      })
      savedRef.current = null
      clearMarks()
      const mic = micRef.current ?? (await openMic(settings.inputId))
      if (!mic) {
        endTrainer(null)
        patch({ phase: 'idle', pass: 0 })
        return
      }
      if (takeRef.current) {
        // Another take began while the microphone was opening; it keeps going.
        endTrainer(null)
        return
      }
      // The trainer may have been stopped while the microphone was opening.
      if (nextRound && !trainerRef.current.running) {
        patch({ phase: 'idle', pass: 0 })
        return
      }
      if (nextRound) {
        const status = `Round ${trainerRef.current.round} at ${percent(speed)} tempo.`
        setState((s) => ({ ...s, trainer: { ...s.trainer, status } }))
      }

      const played: DetectedNote[] = []
      const take: Take = {
        kind,
        trackIndex: track.index,
        strings: track.staves[0]?.tuning.length ?? 0,
        expected,
        played,
        detector: new NoteDetector(mic.sampleRate, (note) => played.push(note)),
        audio: [],
        audioSamples: 0,
        report: null,
        micStartSec: null,
        passes: [newPass(1)],
        looping,
        range,
        loopMs: (timeAt(range.endTick) - timeAt(range.startTick)) / speed,
        lastOutcome: null,
        speed,
        sawPlaying: false,
        userStopped: false,
        ending: false,
        tailTimer: null,
        cleanup: () => {},
      }

      // Set the player up for the take, remembering how to put it back.
      const tracks = api.score.tracks
      api.isLooping = looping
      // Looping without a selection goes round from the starting point to the end.
      const ownRange = looping && !selected
      if (ownRange) api.playbackRange = { ...range } as typeof api.playbackRange
      if (kind === 'measure') {
        // Only the practised track sounds, so the microphone hears exactly
        // the notes the tab expects.
        api.metronomeVolume = 0
        api.countInVolume = 0
        api.changeTrackSolo(tracks, false)
        api.changeTrackMute([track], false)
        api.changeTrackSolo([track], true)
      } else {
        api.countInVolume = 1
      }

      const span = range.endTick - range.startTick
      let lastTick = -1
      const onPosition = (args: { currentTime: number; currentTick: number; isSeek: boolean }) => {
        const pass = take.passes[take.passes.length - 1]
        // Back at the start of the loop: the pass just played is scored once
        // its last notes have arrived, and a new one begins.
        if (
          looping &&
          lastTick >= 0 &&
          args.currentTick < lastTick - span / 2 &&
          args.currentTick <= range.startTick + Math.min(960, span / 2)
        ) {
          lastTick = args.currentTick
          pass.endedAt = performance.now()
          const next = newPass(pass.number + 1)
          take.passes.push(next)
          layerRef.current?.set(new Map())
          const delay = score(take, pass, mic, false)?.latencyMs ?? 0
          pass.timer = window.setTimeout(() => completePass(take, pass), tailWaitMs(delay))
          setState((s) => ({ ...s, pass: next.number, live: null }))
          return
        }
        lastTick = args.currentTick
        if (args.isSeek) {
          // Jumping to another place mid-take (a click on the tab) would
          // leave everything in between counted as missed, so the take ends.
          if (pass.anchors.length > 0 || take.passes.length > 1) {
            take.userStopped = true
            api.pause()
            finish()
          }
          return
        }
        // alphaTab occasionally plays on past the end of a loop instead of
        // going back; then the take sends it back itself.
        if (looping && args.currentTick > range.endTick + 480) {
          api.tickPosition = range.startTick
          return
        }
        if (args.currentTick <= range.startTick) return
        pass.anchors.push(performance.now() - args.currentTime)
        if (args.currentTime > pass.reachedMs) pass.reachedMs = args.currentTime
      }
      const onState = (args: { state: number }) => {
        if (args.state === alphaTab.synth.PlayerState.Playing) take.sawPlaying = true
        else if (take.sawPlaying) finish()
      }
      // alphaTab reports "finished" at every turn of a loop as well.
      const onFinished = () => {
        if (!looping) finish()
      }
      const timer = window.setInterval(() => {
        const live = score(take, take.passes[take.passes.length - 1], mic, false)
        if (!live) return
        const hit = live.results.filter((r) => r.offsetMs !== null).length
        const total = live.results.filter((r) => r.grade !== 'unscored').length
        patch({ live: { hit, total } })
        // Marks wait until the delay is known; before that the grades are guesses.
        if (kind !== 'practice' || live.latencySource === 'none') return
        if (!loadPracticeSettings().liveMarks) return
        const marks = new Map<alphaTab.model.Note, Mark>()
        live.expected.forEach((note, index) => {
          const grade = live.results[index].grade
          if (grade === 'unscored') return
          // A note that comes round again (a repeat) shows its latest result.
          for (const tabNote of note.notes) marks.set(tabNote, grade)
        })
        layerRef.current?.set(marks)
      }, 250)

      take.cleanup = () => {
        window.clearInterval(timer)
        api.playerPositionChanged.off(onPosition)
        api.playerStateChanged.off(onState)
        api.playerFinished.off(onFinished)
        const now = playerRef.current
        api.isLooping = now.isLooping
        if (ownRange) api.playbackRange = null
        api.metronomeVolume = now.metronome ? 1 : 0
        api.countInVolume = now.countIn ? 1 : 0
        if (kind === 'measure' && api.score) {
          const pick = (flag: 'muted' | 'solo') =>
            api.score!.tracks.filter((t) => now.tracks.find((info) => info.index === t.index)?.[flag])
          api.changeTrackSolo(api.score.tracks, false)
          const solo = pick('solo')
          const muted = pick('muted')
          if (solo.length > 0) api.changeTrackSolo(solo, true)
          if (muted.length > 0) api.changeTrackMute(muted, true)
        }
      }

      const moved = seekSettled(api, range.startTick)
      api.stop()
      api.tickPosition = range.startTick
      takeRef.current = take
      patch({ phase: 'recording' })
      // Played only once the cursor is drawn at the start: alphaTab draws it
      // a frame after the move, and drawn while playing (the count-in) it
      // would glide off through the first beat before the song begins.
      await moved
      if (takeRef.current !== take || take.ending) return
      api.playerPositionChanged.on(onPosition)
      api.playerStateChanged.on(onState)
      api.playerFinished.on(onFinished)
      api.play()
    },
    [clearMarks, completePass, endTrainer, finish, openMic, patch, score],
  )
  useEffect(() => {
    startRef.current = start
  }, [start])

  const stop = useCallback(() => {
    const take = takeRef.current
    if (!take) {
      // Between two rounds of the trainer there is no take, only a round waiting to start.
      endTrainer(null)
      return
    }
    take.userStopped = true
    apiRef.current?.pause()
    finish()
  }, [endTrainer, finish])

  // Changing the tempo mid-take would invalidate the expected note times.
  useEffect(() => {
    const take = takeRef.current
    if (take && take.speed !== player.speed) stop()
  }, [player.speed, stop])

  useEffect(
    () => () => {
      abortTake()
      micRequest.current++
      micRef.current?.close()
      micRef.current = null
    },
    [abortTake],
  )

  // In development, expose what the tab expects so automated checks can
  // synthesize a matching performance.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || !api) return
    const debug = {
      /** Notes a take would expect: the selection, or from the playback position to the end. */
      expected: (trackIndex: number, speed = 1) =>
        api.tickCache
          ? collectExpected(
              api.tickCache,
              trackIndex,
              speed,
              api.playbackRange ?? { startTick: Math.max(0, api.tickPosition - POSITION_SLACK), endTick: Number.POSITIVE_INFINITY },
            ).map((note) => ({
              tick: note.tick,
              timeMs: note.timeMs,
              midi: note.midi,
            }))
          : [],
      range: () =>
        api.playbackRange
          ? { startTick: api.playbackRange.startTick, endTick: api.playbackRange.endTick }
          : null,
      speed: () => api.playbackSpeed,
      /** The alphaTab instance itself, for checks that measure the drawn tab. */
      api: () => api,
      /** String rows and frets of the beat at the playback position, as the fretboard should show them. */
      beatNow: () => {
        const track = api.tracks[0]
        const staff = track?.staves[0]
        const found = track && api.tickCache?.findBeat(new Set([track.index]), api.tickPosition)
        if (!staff || !found) return null
        return found.beat.notes
          .map((note) => `${staff.tuning.length - note.string}:${note.fret + staff.capo}`)
          .sort()
      },
    }
    ;(window as unknown as { __riffmaster?: typeof debug }).__riffmaster = debug
  }, [api])

  const actions = useMemo(
    () => ({
      openPanel: () => {
        patch({ open: true, error: null, notice: null })
        if (!micRef.current) void openMic(loadPracticeSettings().inputId)
      },
      closePanel: () => {
        if (takeRef.current) apiRef.current?.pause()
        abortTake()
        closeMic()
        clearMarks()
        patch({
          open: false,
          micReady: false,
          level: 0,
          phase: 'idle',
          result: null,
          live: null,
          pass: 0,
          passes: [],
        })
      },
      selectInput: (id: string) => {
        if (takeRef.current) return
        void openMic(id)
      },
      setMode: (mode: CalibrationMode) => {
        updateSettings((s) => {
          s.mode = mode
        })
        patch({ mode })
      },
      setLiveMarks: (liveMarks: boolean) => {
        updateSettings((s) => {
          s.liveMarks = liveMarks
        })
        patch({ liveMarks })
        if (!liveMarks && takeRef.current) layerRef.current?.clear()
      },
      setLeeway: (leeway: TimingLeeway) => {
        updateSettings((s) => {
          s.leeway = leeway
        })
        patch({ leeway })
      },
      setTrainer: (change: Partial<TrainerSettings>) => {
        const settings = updateSettings((s) => {
          s.trainer = { ...s.trainer, ...change }
        })
        setState((s) => ({ ...s, trainer: { ...s.trainer, ...settings.trainer } }))
      },
      start: () => void start('practice'),
      measure: () => void start('measure'),
      stop,
      dismissResult: () => {
        clearMarks()
        patch({ phase: 'idle', result: null })
      },
      /** Downloads the last take: its recording, with what was expected and heard inside. */
      saveTake: () => {
        const take = savedRef.current
        if (!take?.report) return
        const report = { app: 'RiffMaster', savedAt: new Date().toISOString(), ...take.report() }
        const stamp = report.savedAt.slice(0, 16).replace(/[T:]/g, '-')
        const sampleRate = micRef.current?.sampleRate ?? (report as { sampleRate?: number }).sampleRate ?? 48000
        downloadFile(`riffmaster-take-${stamp}.wav`, encodeTake(take.audio, sampleRate, report), 'audio/wav')
      },
      /** What the last take expected and heard, note by note; null when no take is held. */
      takeDetails: (): TakeDetails | null => {
        const take = savedRef.current
        const report = take?.report ? readTakeReport(take.report()) : null
        return take && report ? describeTake(report, inputLevel(take.audio)) : null
      },
    }),
    [abortTake, clearMarks, closeMic, openMic, patch, start, stop, updateSettings],
  )

  return { state, actions }
}

export type PracticeActions = ReturnType<typeof usePractice>['actions']
