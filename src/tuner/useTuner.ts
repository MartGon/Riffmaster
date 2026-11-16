import { PitchDetector } from 'pitchy'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadPracticeSettings } from '../practice/deviceSettings'
import { MicInput } from '../practice/micInput'
import { median, readTuning, type TuneReading } from './tuning'

export interface TunerState {
  open: boolean
  error: string | null
  /** True once the input is open and being listened to. */
  listening: boolean
  /** What is sounding now, or null when it is quiet or unclear. */
  reading: (TuneReading & { hz: number }) | null
}

const WINDOW = 4096
const STEP = 2048
/** Quieter than this (root mean square, full scale being 1) counts as silence. */
const QUIET = 0.003

/**
 * A tuner: listens to the instrument and reports which string is sounding
 * and how far it is from its pitch. It uses the input chosen for practice.
 */
export function useTuner(tuning: number[]) {
  const [state, setState] = useState<TunerState>({ open: false, error: null, listening: false, reading: null })
  const micRef = useRef<MicInput | null>(null)
  const request = useRef(0)
  const tuningRef = useRef(tuning)
  useEffect(() => {
    tuningRef.current = tuning
  })

  const close = useCallback(() => {
    request.current++
    micRef.current?.close()
    micRef.current = null
    setState({ open: false, error: null, listening: false, reading: null })
  }, [])

  const open = useCallback(async () => {
    const mine = ++request.current
    micRef.current?.close()
    micRef.current = null
    setState({ open: true, error: null, listening: false, reading: null })
    let mic: MicInput
    try {
      const inputId = loadPracticeSettings().inputId
      try {
        mic = await MicInput.open(inputId)
      } catch (error) {
        if (!inputId || !(error instanceof DOMException) || error.name !== 'OverconstrainedError') throw error
        mic = await MicInput.open(null)
      }
    } catch (error) {
      if (mine !== request.current) return
      const blocked = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      setState((s) => ({
        ...s,
        error: blocked
          ? 'Microphone access was blocked. Allow it for this site in your browser settings, then try again.'
          : 'Could not open the audio input.',
      }))
      return
    }
    // The tuner may have been closed while the browser was asking for permission.
    if (mine !== request.current) {
      mic.close()
      return
    }
    micRef.current = mic

    const detector = PitchDetector.forFloat32Array(WINDOW)
    const ring = new Float32Array(WINDOW)
    const frame = new Float32Array(WINDOW)
    let written = 0
    let sinceAnalysis = 0
    let quietRuns = 0
    const recent: number[] = []
    mic.onBlock = ({ samples }) => {
      for (let i = 0; i < samples.length; i++) ring[(written + i) % WINDOW] = samples[i]
      written += samples.length
      sinceAnalysis += samples.length
      if (written < WINDOW || sinceAnalysis < STEP) return
      sinceAnalysis = 0
      let power = 0
      for (let i = 0; i < WINDOW; i++) {
        const sample = ring[(written + i) % WINDOW]
        frame[i] = sample
        power += sample * sample
      }
      let hz = 0
      if (Math.sqrt(power / WINDOW) >= QUIET) {
        const [pitch, clarity] = detector.findPitch(frame, mic.sampleRate)
        if (clarity >= 0.9 && pitch > 25 && pitch < 1500) hz = pitch
      }
      if (hz === 0) {
        // A short gap keeps the last reading, so the display does not flicker as a note fades.
        if (++quietRuns < 8) return
        recent.length = 0
        setState((s) => (s.reading ? { ...s, reading: null } : s))
        return
      }
      quietRuns = 0
      // A jump to another string starts afresh instead of gliding there.
      if (recent.length > 0 && Math.abs(Math.log2(hz / median(recent))) > 1 / 12) recent.length = 0
      recent.push(hz)
      if (recent.length > 5) recent.shift()
      const steady = median(recent)
      setState((s) => ({ ...s, reading: { hz: steady, ...readTuning(steady, tuningRef.current) } }))
    }
    setState((s) => ({ ...s, listening: true }))
  }, [])

  useEffect(
    () => () => {
      request.current++
      micRef.current?.close()
      micRef.current = null
    },
    [],
  )

  const actions = useMemo(() => ({ open: () => void open(), close }), [close, open])
  return { state, actions }
}
