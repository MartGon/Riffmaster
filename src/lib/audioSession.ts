/**
 * Makes the song audible on an iPhone whose silent switch is on.
 *
 * iOS treats web audio as "ambient" sound by default, which the silent
 * switch mutes. Media playback, like a music app's, is not muted. Safari
 * 17 and later let a page say which kind it is (`navigator.audioSession`).
 * Older versions switch to media playback while an <audio> element plays,
 * so there a silent one is started on the first tap and kept going.
 */

type SessionType = 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record'

function audioSession(): { type: SessionType } | undefined {
  return (navigator as Navigator & { audioSession?: { type: SessionType } }).audioSession
}

/** Whether this is an iPhone, iPad or iPod (iPads report themselves as Macs with touch). */
export function isAppleTouch(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/** 0.1 s of silence as a WAV file: 8 kHz, 8-bit mono, so 800 samples of the midpoint 128. */
function silentWav(): string {
  const samples = 800
  const bytes = new Uint8Array(44 + samples)
  const view = new DataView(bytes.buffer)
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i)
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true)
  view.setUint32(28, 8000, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  text(36, 'data')
  view.setUint32(40, samples, true)
  bytes.fill(128, 44)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:audio/wav;base64,${btoa(binary)}`
}

let silence: HTMLAudioElement | null = null

/** Starts the silent <audio> element; it must happen during a tap or key press. */
function keepMediaSessionAlive(): void {
  if (!silence) {
    silence = new Audio(silentWav())
    silence.loop = true
    silence.setAttribute('playsinline', '')
    // A paused page does not need it; it starts again with the next tap.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) silence?.pause()
    })
  }
  if (silence.paused) void silence.play().catch(() => {})
}

/**
 * Asks for media playback, so the silent switch does not mute the song.
 * Call it from a tap or key press. Does nothing while the microphone is in
 * use: recording uses the "play and record" kind, which is not muted either.
 */
export function preferPlayback(): void {
  const session = audioSession()
  if (session) {
    if (session.type !== 'play-and-record') session.type = 'playback'
    return
  }
  if (isAppleTouch()) keepMediaSessionAlive()
}

/** For the microphone: playback and recording together, not a phone call. */
export function allowRecording(): void {
  const session = audioSession()
  if (session) session.type = 'play-and-record'
}

/** After the microphone is closed: back to plain media playback. */
export function recordingEnded(): void {
  const session = audioSession()
  if (session) session.type = 'playback'
}
