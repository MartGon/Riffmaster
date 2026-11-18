/**
 * A log of what the player and the audio do, shown on the page when it is
 * opened with `?debug` (kept for the rest of the visit). It exists for
 * phones, where there are no developer tools to look at: the log can be
 * copied and sent. Without `?debug` nothing is recorded.
 */

const KEY = 'riffmaster.debug'

function readEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.has('debug')) sessionStorage.setItem(KEY, '1')
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return new URLSearchParams(window.location.search).has('debug')
  }
}

let enabled: boolean | null = null
export function debugEnabled(): boolean {
  enabled ??= readEnabled()
  return enabled
}

let lines: readonly string[] = []
const listeners = new Set<() => void>()
const start = typeof performance === 'undefined' ? 0 : performance.now()

export function debug(message: string): void {
  if (!debugEnabled()) return
  const seconds = ((performance.now() - start) / 1000).toFixed(2).padStart(7)
  // A new list each time, so React sees the change.
  lines = [...lines.slice(-399), `${seconds}  ${message}`]
  for (const listener of listeners) listener()
}

export function debugLines(): readonly string[] {
  return lines
}

export function onDebug(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Describes an error in one line, whatever was thrown. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

let started = false

/** Records the browser and page facts that matter for playback, and errors from anywhere on the page. */
export function startDebugLog(): void {
  if (started || !debugEnabled()) return
  started = true
  const nav = navigator as Navigator & { audioSession?: { type: string }; standalone?: boolean }
  debug(`page ${location.href}`)
  debug(`agent ${navigator.userAgent}`)
  debug(
    [
      `secure=${window.isSecureContext}`,
      `audioWorklet=${typeof AudioWorkletNode !== 'undefined'}`,
      `worker=${typeof Worker !== 'undefined'}`,
      `sharedArrayBuffer=${typeof SharedArrayBuffer !== 'undefined'}`,
      `audioSession=${nav.audioSession ? nav.audioSession.type : 'none'}`,
      `homeScreen=${nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches}`,
      `serviceWorker=${navigator.serviceWorker?.controller ? 'controlling' : 'none'}`,
    ].join(' '),
  )
  window.addEventListener('error', (event) => debug(`page error: ${event.message} at ${event.filename}:${event.lineno}`))
  window.addEventListener('unhandledrejection', (event) => debug(`unhandled: ${describeError(event.reason)}`))
  document.addEventListener('visibilitychange', () => debug(`page ${document.visibilityState}`))
}

let meter: { context: BaseAudioContext; analyser: AnalyserNode } | null = null
let meterInstalled = false

/**
 * Taps everything the page sends to the speaker, so the log can say whether
 * the song is actually there or silent. Only with `?debug`.
 */
export function installLevelMeter(): void {
  if (meterInstalled || !debugEnabled() || typeof AudioNode === 'undefined') return
  meterInstalled = true
  const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown
  AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
    const target = args[0]
    if (typeof AudioDestinationNode !== 'undefined' && target instanceof AudioDestinationNode) {
      if (!meter || meter.context !== this.context) {
        const analyser = this.context.createAnalyser()
        analyser.fftSize = 2048
        meter = { context: this.context, analyser }
        debug(`level meter on a ${this.context.constructor.name}`)
      }
      connect.call(this, meter.analyser)
    }
    return connect.apply(this, args)
  } as typeof AudioNode.prototype.connect
}

/** The loudest sample in the last ~40 ms sent to the speaker, from 0 to 1, or a note why there is none. */
export function level(): string {
  if (!meter) return 'level: nothing connected'
  const samples = new Float32Array(meter.analyser.fftSize)
  meter.analyser.getFloatTimeDomainData(samples)
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  return `level ${peak.toFixed(3)}`
}

/** Plays a short tone through the audio context the player uses (or a new one), to hear whether sound gets out at all. */
export function beep(): void {
  const context = (meter?.context as AudioContext | undefined) ?? new AudioContext()
  void (context as AudioContext).resume?.()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.frequency.value = 660
  gain.gain.value = 0.3
  oscillator.connect(gain).connect(context.destination)
  oscillator.start()
  oscillator.stop(context.currentTime + 0.4)
  debug(`beep on a ${context.constructor.name}, state ${(context as AudioContext).state}`)
}
