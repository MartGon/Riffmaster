import type * as alphaTab from '@coderline/alphatab'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getRecording } from '../library/db'
import type { TakeRecord } from '../library/types'

/** What is heard while listening back: the take, the song as written, or both together. */
export type ListenMix = 'both' | 'take' | 'original'

export interface ListenState {
  /** The take being listened to, or null. */
  takeId: string | null
  loading: boolean
  mix: ListenMix
  error: string | null
}

interface PlayerNow {
  /** The player's own volume, which "Your take" turns down and listening puts back. */
  masterVolume: number
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
  /** (page clock − song clock) of the latest position reports. */
  anchors: number[]
  /** Readings in a row that found the take out of line. */
  drifting: number
  /** The player as it was, put back exactly afterwards: listening changes none of the choices that are kept. */
  before: {
    speed: number
    countIn: number
    metronome: number
    looping: boolean
    range: alphaTab.synth.PlaybackRange | null
    tick: number
  } | null
  playing: boolean
  unsubscribe: () => void
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]
}

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
 * The player is changed directly and put back afterwards, so nothing it
 * remembers (the song's speed, count-in, metronome) is changed by listening.
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
      if (player) {
        if (player.playerState === 1) player.pause()
        player.masterVolume = playerRef.current.masterVolume
        const before = run.before
        if (before) {
          player.playbackSpeed = before.speed
          player.countInVolume = before.countIn
          player.metronomeVolume = before.metronome
          player.isLooping = before.looping
          player.playbackRange = before.range
          player.tickPosition = before.tick
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
        before: null,
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
        run.buffer = buffer
        run.songStartMs = recording.songStartMs
        const onPosition = (args: alphaTab.synth.PositionChangedEventArgs) => {
          if (runRef.current !== run || !run.playing) return
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
            run.playing = true
            return
          }
          // Stopped by hand or at the end of the take's bars: listening is over.
          if (run.playing) stop()
        }
        if (api.playerState === 1) api.pause()
        run.before = {
          speed: api.playbackSpeed,
          countIn: api.countInVolume,
          metronome: api.metronomeVolume,
          looping: api.isLooping,
          range: api.playbackRange,
          tick: api.tickPosition,
        }
        api.playerPositionChanged.on(onPosition)
        api.playerStateChanged.on(onState)
        run.unsubscribe = () => {
          api.playerPositionChanged.off(onPosition)
          api.playerStateChanged.off(onState)
        }
        // The take's bars once through, at its speed, with nothing else sounding.
        api.playbackSpeed = recording.speed
        api.countInVolume = 0
        api.metronomeVolume = 0
        api.isLooping = false
        api.playbackRange = { startTick: recording.startTick, endTick: recording.endTick }
        api.tickPosition = recording.startTick
        applyMix(mixRef.current)
        setState((s) => ({ ...s, loading: false }))
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

  useEffect(() => stop, [stop])

  const actions = useMemo(() => ({ listen: (take: TakeRecord) => void listen(take), stop, setMix }), [listen, setMix, stop])
  return { state, actions }
}
