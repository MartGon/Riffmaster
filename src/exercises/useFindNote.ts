import { useCallback, useEffect, useRef, useState } from 'react'
import { NoteDetector } from '../practice/detector'
import { loadPracticeSettings } from '../practice/deviceSettings'
import { MicInput } from '../practice/micInput'
import {
  bestKey,
  buildTargets,
  difficultyFactor,
  FindNoteGame,
  type FindNoteSettings,
  type FindNoteTarget,
  type GameNote,
  type GameSummary,
  loadFindNote,
  mergeBest,
  type RoundResult,
  saveFindNote,
} from './findNote'

export type GamePhase = 'setup' | 'opening' | 'count' | 'asking' | 'answered' | 'done'

export interface GameView {
  phase: GamePhase
  error: string | null
  count: number
  index: number
  total: number
  target: FindNoteTarget | null
  /** Share of the note's time left, from 1 to 0. */
  left: number
  score: number
  streak: number
  heardWrong: number | null
  last: RoundResult | null
  summary: GameSummary | null
  /** The best score before this game, for these settings. */
  previousBest: number | null
}

const IDLE: GameView = {
  phase: 'setup',
  error: null,
  count: 0,
  index: 0,
  total: 0,
  target: null,
  left: 1,
  score: 0,
  streak: 0,
  heardWrong: null,
  last: null,
  summary: null,
  previousBest: null,
}

const COUNT_FROM = 3
/** How long the answer stays up before the next note, in ms. */
const ANSWER_MS = 800
const TICK_MS = 50
/** With no audio for this long the clock of the game has stopped, so it cannot go on fairly. */
const STALLED_MS = 1500
/** The same for the first audio, which takes longer to arrive. */
const FIRST_AUDIO_MS = 4000

async function openInput(): Promise<MicInput> {
  const inputId = loadPracticeSettings().inputId
  try {
    return await MicInput.open(inputId)
  } catch (error) {
    if (!inputId || !(error instanceof DOMException) || error.name !== 'OverconstrainedError') throw error
    return MicInput.open(null)
  }
}

/** Runs a game of Find the note against the chosen audio input. */
export function useFindNote() {
  const [view, setView] = useState<GameView>(IDLE)
  const [store, setStore] = useState(loadFindNote)
  const storeRef = useRef(store)
  /** Each start or stop gets a number, so what was on its way for an older one is dropped. */
  const run = useRef(0)
  const micRef = useRef<MicInput | null>(null)
  const timerRef = useRef<number | null>(null)
  /** Whether a game is under way, from Start, including while the microphone opens. */
  const active = useRef(false)

  const release = useCallback(() => {
    run.current++
    active.current = false
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
    micRef.current?.close()
    micRef.current = null
  }, [])

  const stop = useCallback(
    (error: string | null = null) => {
      release()
      setView({ ...IDLE, error })
    },
    [release],
  )

  const changeSettings = useCallback((change: Partial<FindNoteSettings>) => {
    const best = mergeBest(storeRef.current.best, loadFindNote().best)
    const next = { best, settings: { ...storeRef.current.settings, ...change } }
    storeRef.current = next
    setStore(next)
    saveFindNote(next)
  }, [])

  const start = useCallback(async () => {
    release()
    active.current = true
    const mine = run.current
    const { settings } = storeRef.current
    const key = bestKey(settings)
    const previousBest = mergeBest(storeRef.current.best, loadFindNote().best)[key] ?? null
    const game = new FindNoteGame(buildTargets(settings), difficultyFactor(settings))
    setView({ ...IDLE, phase: 'opening', total: game.targets.length, previousBest })

    let mic: MicInput
    try {
      mic = await openInput()
    } catch (error) {
      if (mine !== run.current) return
      // Over: leaving for the settings to allow the microphone must not replace this message.
      active.current = false
      const blocked = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      setView({
        ...IDLE,
        error: blocked
          ? 'Microphone access was blocked. Allow it for this site in your browser settings, then try again.'
          : 'Could not open the audio input.',
      })
      return
    }
    if (mine !== run.current) {
      mic.close()
      return
    }
    micRef.current = mic

    // Counted in the samples the detector has had, so its notes and the prompts share one clock.
    let fed = 0
    let lastBlockAt = performance.now()
    const audioNow = () => fed / mic.sampleRate
    const show = (phase: GamePhase, change: Partial<GameView> = {}) =>
      setView((current) => ({
        ...current,
        phase,
        index: game.index,
        target: game.current,
        score: game.score,
        streak: game.streak,
        heardWrong: game.heardWrong,
        ...change,
      }))

    let stage: 'count' | 'asking' | 'answered' = 'count'
    // The count starts with the first audio.
    let nextAt = Number.POSITIVE_INFINITY
    let count = COUNT_FROM

    const ask = () => {
      stage = 'asking'
      game.ask(audioNow())
      show('asking', { left: 1, last: null })
    }
    const answered = (result: RoundResult) => {
      stage = 'answered'
      nextAt = performance.now() + ANSWER_MS
      // Shows the note just answered, whose place the player may want to see.
      show('answered', { last: result, target: result.target, index: game.index - 1 })
    }
    const finish = () => {
      const summary = game.summary()
      const best = mergeBest(storeRef.current.best, loadFindNote().best)
      // Judged against the best as it is now, which another tab may have raised meanwhile.
      const before = best[key] ?? null
      if (summary.score > 0) best[key] = Math.max(summary.score, best[key] ?? 0)
      const next = { ...storeRef.current, best }
      storeRef.current = next
      setStore(next)
      saveFindNote(next)
      release()
      setView((current) => ({ ...current, phase: 'done', summary, score: summary.score, target: null, last: null, previousBest: before }))
    }

    const detector = new NoteDetector(mic.sampleRate, (note: GameNote) => {
      if (mine !== run.current || stage !== 'asking') return
      const result = game.hear(note)
      if (result) answered(result)
      else show('asking')
    })
    mic.onBlock = ({ samples }) => {
      lastBlockAt = performance.now()
      if (fed === 0) nextAt = lastBlockAt + 1000
      fed += samples.length
      detector.feed(samples)
    }
    mic.onLost = () => {
      if (mine === run.current) stop('The audio input went away. Plug it back in and start again.')
    }

    setView((current) => ({ ...current, phase: 'count', count, target: null }))
    timerRef.current = window.setInterval(() => {
      if (mine !== run.current) return
      const now = performance.now()
      if (now - lastBlockAt > (fed === 0 ? FIRST_AUDIO_MS : STALLED_MS)) {
        stop('The audio input stopped sending sound. Start again.')
        return
      }
      if (stage === 'count') {
        if (now < nextAt) return
        count--
        nextAt += 1000
        if (count > 0) setView((current) => ({ ...current, count }))
        else ask()
      } else if (stage === 'answered') {
        if (now < nextAt) return
        if (game.finished) finish()
        else ask()
      } else {
        const at = audioNow()
        const result = game.expire(at)
        if (result) answered(result)
        else setView((current) => ({ ...current, left: game.timeLeft(at) }))
      }
    }, TICK_MS)
  }, [release, stop])

  // Timers and audio stop in a hidden page, so a game cannot go on fairly.
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden' && active.current) stop('The game stopped because the app went to the background.')
    }
    document.addEventListener('visibilitychange', hidden)
    return () => document.removeEventListener('visibilitychange', hidden)
  }, [stop])

  useEffect(() => release, [release])

  return { view, settings: store.settings, best: store.best, changeSettings, start, stop }
}
