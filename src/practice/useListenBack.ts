import type * as alphaTab from '@coderline/alphatab'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getRecording } from '../library/db'
import type { TakeRecord } from '../library/types'
import { applyPitch } from '../player/usePlayer'

/** What is heard while listening back: the take, the song as written, or both together. */
export type ListenMix = 'both' | 'take' | 'original'

export interface ListenState {
  /** The take being listened to, or null. */
  takeId: string | null
  loading: boolean
  mix: ListenMix
  error: string | null
}

/** The player's choices, put back when listening ends; changing one while listening ends it. */
interface PlayerNow {
  /** The player's own volume, which "Your take" turns down. */
  masterVolume: number
  speed: number
  metronome: boolean
  countIn: boolean
  isLooping: boolean
  pitch: number
}

/**
 * Further apart than this, in seconds, three readings running, the take is
 * moved back in line with the song; further than the second, at once. A
 * busy page reports the song's clock late now and then, and each move is heard.
 */
const DRIFT_SEC = 0.06
const JUMP_SEC = 0.25
const DRIFT_READINGS = 3
/** Readings of the song's clock the take is lined up by. */
const READINGS = 8

interface Run {
  takeId: string
  context: AudioContext
  buffer: AudioBuffer | null
  gain: GainNode
  source: AudioBufferSourceNode | null
  /** Where in the take the source began, and when on the audio clock. */
  startedOffset: number
  startedAt: number
  songStartMs: number
  /** The pitch the take was played at, when it is not the song's now. */
  pitch: number | null
  /** (page clock − song clock) of the latest position reports. */
  anchors: number[]
  /** Readings in a row that found the take out of line. */
  drifting: number
  /** The bars played under the take, and the section and position they replaced, put back unless changed meanwhile. */
  range: alphaTab.synth.PlaybackRange | null
  before: { range: alphaTab.synth.PlaybackRange | null; tick: number; resetOnClick: boolean } | null
  /** The song listened under, and the speed it was set to: what is found otherwise when listening ends was changed meanwhile, and stays. */
  score: alphaTab.model.Score | null
  speed: number
  /** Set once the song is started for the take, so the player's own earlier state is not taken for it. */
  started: boolean
  playing: boolean
  unsubscribe: () => void
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]
}

const sameRange = (a: alphaTab.synth.PlaybackRange | null, b: alphaTab.synth.PlaybackRange | null) =>
  a?.startTick === b?.startTick && a?.endTick === b?.endTick

/** Shifts the song's pitched tracks, as the player does. */
const setPitch = (api: alphaTab.AlphaTabApi, pitch: number) => {
  if (api.score) applyPitch(api, api.score, pitch)
}

/** Pauses the player, and waits until it has paused (or a second has passed). */
const pausePlayer = (api: alphaTab.AlphaTabApi) =>
  new Promise<void>((resolve) => {
    const done = () => {
      window.clearTimeout(timer)
      api.playerStateChanged.off(paused)
      resolve()
    }
    // The player tells a new listener its state at once; only a change counts.
    const paused = (args: alphaTab.synth.PlayerStateChangedEventArgs) => {
      if (args.state !== 1) done()
    }
    const timer = window.setTimeout(done, 1000)
    api.playerStateChanged.on(paused)
    api.pause()
  })

const stopSource = (run: Run) => {
  try {
    run.source?.stop()
  } catch {
    // Already ended.
  }
  run.source = null
}

/**
 * Plays a take's recording with the song, the cursor running along the tab.
 * The song plays at the take's speed over its bars; the recording follows the
 * song's clock, so it stays in line even if the song starts a little late.
 * The player is changed directly and put back afterwards to the choices it
 * holds (the song's speed, count-in, metronome, pitch), so listening changes
 * none of them; changing one while listening ends it.
 */
export function useListenBack(api: alphaTab.AlphaTabApi | null, player: PlayerNow) {
  const [state, setState] = useState<ListenState>({ takeId: null, loading: false, mix: 'both', error: null })
  const runRef = useRef<Run | null>(null)
  const request = useRef(0)
  const playerRef = useRef(player)
  const mixRef = useRef<ListenMix>('both')
  // The player is changed through a ref: it is not this hook's to own.
  const apiRef = useRef(api)
  useEffect(() => {
    apiRef.current = api
    playerRef.current = player
  })

  /** Sets what is heard: the take through its own gain, the song through the player's volume. */
  const applyMix = useCallback((mix: ListenMix) => {
    const run = runRef.current
    const player = apiRef.current
    if (!run) return
    run.gain.gain.value = mix === 'original' ? 0 : 1
    if (player) player.masterVolume = mix === 'take' ? 0 : playerRef.current.masterVolume
  }, [])

  // The volume slider moved while listening: the mix still decides whether the song is heard.
  const volume = player.masterVolume
  useEffect(() => {
    if (runRef.current) applyMix(mixRef.current)
  }, [applyMix, volume])

  const stop = useCallback(() => {
    request.current++
    const run = runRef.current
    runRef.current = null
    if (run) {
      run.unsubscribe()
      stopSource(run)
      void run.context.close().catch(() => {})
      const player = apiRef.current
      const before = run.before
      if (player && before) {
        const now = playerRef.current
        player.masterVolume = now.masterVolume
        player.settings.player.resetPlaybackRangeOnClick = before.resetOnClick
        // Another song has been opened since and set the player up itself.
        if (player.score === run.score) {
          if (player.playerState === 1) player.pause()
          // Each choice is put back only where it is still as listening set it.
          if (player.playbackSpeed === run.speed) player.playbackSpeed = now.speed
          if (player.countInVolume === 0) player.countInVolume = now.countIn ? 1 : 0
          if (player.metronomeVolume === 0) player.metronomeVolume = now.metronome ? 1 : 0
          if (!player.isLooping) player.isLooping = now.isLooping
          if (run.pitch !== null) setPitch(player, now.pitch)
          // Bars chosen while listening stay chosen.
          if (sameRange(player.playbackRange, run.range)) {
            player.playbackRange = before.range
            player.tickPosition = before.tick
          }
        }
      }
    }
    setState((s) => (s.takeId === null && !s.loading && s.error === null ? s : { ...s, takeId: null, loading: false, error: null }))
  }, [])

  /** Starts the take where the song is now, or moves it there if it has drifted. */
  const follow = useCallback((run: Run) => {
    if (run.anchors.length === 0 || !run.buffer) return
    const songNowMs = performance.now() - median(run.anchors)
    const wanted = (songNowMs - run.songStartMs) / 1000
    // Past its end, the take is over; the song may play on.
    if (wanted >= run.buffer.duration) {
      stopSource(run)
      return
    }
    if (run.source) {
      const actual = run.startedOffset + (run.context.currentTime - run.startedAt)
      const off = Math.abs(actual - wanted)
      run.drifting = off < DRIFT_SEC ? 0 : run.drifting + 1
      if (off < JUMP_SEC && run.drifting < DRIFT_READINGS) return
      run.drifting = 0
      stopSource(run)
    }
    const source = run.context.createBufferSource()
    source.buffer = run.buffer
    source.connect(run.gain)
    // Before the take begins, it waits; otherwise it starts part-way in.
    const delay = Math.max(0, -wanted)
    run.startedAt = run.context.currentTime + delay
    run.startedOffset = Math.max(0, wanted)
    source.start(run.startedAt, run.startedOffset)
    run.source = source
  }, [])

  const listen = useCallback(
    async (take: TakeRecord) => {
      stop()
      const api = apiRef.current
      if (!api) return
      const mine = ++request.current
      // Made at once, within the tap: iOS lets a page's audio start only from a tap.
      const context = new AudioContext()
      const resumed = context.state === 'suspended' ? context.resume() : Promise.resolve()
      const gain = context.createGain()
      gain.connect(context.destination)
      const run: Run = {
        takeId: take.id,
        context,
        buffer: null,
        gain,
        source: null,
        startedOffset: 0,
        startedAt: 0,
        songStartMs: 0,
        anchors: [],
        drifting: 0,
        range: null,
        pitch: null,
        before: null,
        score: api.score,
        speed: 1,
        started: false,
        playing: false,
        unsubscribe: () => {},
      }
      runRef.current = run
      setState((s) => ({ ...s, takeId: take.id, loading: true, error: null }))
      try {
        const [recording] = await Promise.all([getRecording(take.id), resumed])
        if (!recording) throw new Error('missing')
        const buffer = await context.decodeAudioData(recording.wav.slice(0))
        if (mine !== request.current || runRef.current !== run) return
        // The song playing is stopped first: until the player says it has, it would not start again.
        if (api.playerState === 1) {
          await pausePlayer(api)
          if (mine !== request.current || runRef.current !== run) return
        }
        run.buffer = buffer
        run.songStartMs = recording.songStartMs
        const onPosition = (args: alphaTab.synth.PositionChangedEventArgs) => {
          if (runRef.current !== run || !run.playing) return
          // Other bars were chosen: the take no longer belongs under them.
          if (!sameRange(api.playbackRange, run.range)) {
            stop()
            return
          }
          // Moved by hand: what was known of the clock no longer holds.
          if (args.isSeek) {
            run.anchors = []
            stopSource(run)
            return
          }
          run.anchors.push(performance.now() - args.currentTime)
          if (run.anchors.length > READINGS) run.anchors.shift()
          follow(run)
        }
        const onState = (args: alphaTab.synth.PlayerStateChangedEventArgs) => {
          if (runRef.current !== run) return
          if (args.state === 1) {
            if (run.started) run.playing = true
            return
          }
          // Stopped by hand or at the end of the take's bars: listening is over.
          if (run.playing) stop()
        }
        run.before = { range: api.playbackRange, tick: api.tickPosition, resetOnClick: api.settings.player.resetPlaybackRangeOnClick }
        api.playerPositionChanged.on(onPosition)
        api.playerStateChanged.on(onState)
        run.unsubscribe = () => {
          api.playerPositionChanged.off(onPosition)
          api.playerStateChanged.off(onState)
        }
        // The take's bars once through, at its speed, with nothing else sounding.
        api.playbackSpeed = recording.speed
        run.speed = api.playbackSpeed
        // A tap on the tab moves within the take's bars rather than letting them go.
        api.settings.player.resetPlaybackRangeOnClick = false
        api.countInVolume = 0
        api.metronomeVolume = 0
        api.isLooping = false
        run.range = { startTick: recording.startTick, endTick: recording.endTick }
        api.playbackRange = run.range
        api.tickPosition = recording.startTick
        // In the key it was played in.
        if (recording.pitch !== undefined && recording.pitch !== playerRef.current.pitch) {
          run.pitch = recording.pitch
          setPitch(api, recording.pitch)
        }
        applyMix(mixRef.current)
        setState((s) => ({ ...s, loading: false }))
        run.started = true
        api.play()
      } catch {
        if (mine !== request.current || runRef.current !== run) return
        runRef.current = null
        run.unsubscribe()
        void context.close().catch(() => {})
        setState((s) => ({ ...s, takeId: null, loading: false, error: 'This take could not be played back.' }))
      }
    },
    [applyMix, follow, stop],
  )

  const setMix = useCallback(
    (mix: ListenMix) => {
      mixRef.current = mix
      applyMix(mix)
      setState((s) => ({ ...s, mix }))
    },
    [applyMix],
  )

  // A choice changed while listening: listening ends, and the player keeps the new choice.
  const { speed, metronome, countIn, isLooping, pitch } = player
  useEffect(() => {
    if (runRef.current) stop()
  }, [speed, metronome, countIn, isLooping, pitch, stop])

  useEffect(() => stop, [stop])

  const actions = useMemo(() => ({ listen: (take: TakeRecord) => void listen(take), stop, setMix }), [listen, setMix, stop])
  return { state, actions }
}
