import { PitchDetector } from 'pitchy'
import { FFT_SIZE, likelyPitches, magnitudeSpectrum } from './spectrum'

export interface DetectedNote {
  /** Position of the note's start, in seconds of audio fed to the detector. */
  timeSec: number
  /**
   * MIDI pitches the note could be, the most likely first. Usually one;
   * a second appears when the octave is ambiguous.
   */
  midi: number[]
}

export interface DetectorOptions {
  /** Signal below this level (dB relative to full scale) is treated as silence. */
  gateDb: number
  /** How much a pick attack must rise above the recent level, in dB. */
  onsetRiseDb: number
  /** Shortest time between two notes, in seconds. */
  minGapSec: number
  /** How sure a pitch reading must be, from 0 to 1, to follow hammer-ons and slides. */
  clarity: number
}

export const defaultDetectorOptions: DetectorOptions = {
  gateDb: -50,
  onsetRiseDb: 6,
  minGapSec: 0.07,
  clarity: 0.9,
}

const HOP = 256
const TRACK_WINDOW = 2048
const RING = 16384
/** Samples skipped after an attack so the pick noise does not colour the pitch. */
const SKIP_SEC = 0.004
/** Shortest stretch of a note worth analysing, in samples. */
const MIN_ANALYSIS = 1024

export function frequencyToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440)
}

const toDb = (power: number) => 10 * Math.log10(power + 1e-12)

/**
 * Turns a stream of mono audio into note events for a single-note line.
 *
 * A picked note is found by its attack: a sudden rise in the bright,
 * high-frequency part of the signal. Its pitch is read from what the attack
 * *added* to the sound (the spectrum just after it minus the spectrum just
 * before), so a note is still heard correctly while earlier notes ring on,
 * as in an arpeggio. Hammer-ons, pull-offs and slides have no attack and
 * are found as a change of pitch within a single ringing note.
 */
export class NoteDetector {
  private readonly options: DetectorOptions
  private readonly sampleRate: number
  private readonly onNote: (note: DetectedNote) => void
  private readonly tracker: PitchDetector<Float32Array>
  private readonly ring = new Float32Array(RING)
  private readonly hop = new Float32Array(HOP)
  private hopFill = 0
  /** Total samples received so far. */
  private frames = 0
  private previousSample = 0
  /** Recent attack levels in dB; a new attack must stand out above all of them. */
  private readonly recent: number[] = []
  private lastNoteFrame = -RING
  /** Attacks whose pitch has not been read yet, as sample positions, oldest first. */
  private readonly pending: number[] = []
  /** The note currently ringing, when a plain pitch reading agrees with it. */
  private current: { midi: number; confirmed: boolean } | null = null
  /** A different pitch seen once, waiting for a second reading to confirm it. */
  private candidate: { midi: number; frame: number } | null = null
  private hopsSinceTrack = 0

  constructor(
    sampleRate: number,
    onNote: (note: DetectedNote) => void,
    options: Partial<DetectorOptions> = {},
  ) {
    this.sampleRate = sampleRate
    this.onNote = onNote
    this.options = { ...defaultDetectorOptions, ...options }
    this.tracker = PitchDetector.forFloat32Array(TRACK_WINDOW)
    this.tracker.minVolumeDecibels = this.options.gateDb
  }

  /** Feeds the next samples; blocks may be of any length. */
  feed(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      this.hop[this.hopFill++] = samples[i]
      if (this.hopFill === HOP) {
        this.processHop()
        this.hopFill = 0
      }
    }
  }

  /** Reads the pitch of attacks still waiting for more audio. Call when the audio ends. */
  flush(): void {
    while (this.pending.length > 0) this.resolvePending(true)
  }

  private processHop(): void {
    const { hop, ring, options } = this
    const hopStart = this.frames
    for (let i = 0; i < HOP; i++) ring[(hopStart + i) % RING] = hop[i]
    this.frames += HOP

    // Level of the whole signal, and of its bright part (first difference),
    // where a pick attack stands out even over strings that are still ringing.
    let power = 0
    let bright = 0
    let previous = this.previousSample
    for (let i = 0; i < HOP; i++) {
      const sample = hop[i]
      power += sample * sample
      const edge = sample - previous
      bright += edge * edge
      previous = sample
    }
    this.previousSample = previous
    const audible = toDb(power / HOP) > options.gateDb
    const brightDb = toDb(bright / HOP)
    const baseline = this.recent.length > 0 ? Math.max(...this.recent) : brightDb
    this.recent.push(brightDb)
    if (this.recent.length > 8) this.recent.shift() // about 40 ms at 48 kHz

    const minGap = options.minGapSec * this.sampleRate
    if (
      audible &&
      brightDb - baseline >= options.onsetRiseDb &&
      hopStart - this.lastNoteFrame >= minGap
    ) {
      this.lastNoteFrame = hopStart
      this.pending.push(hopStart)
      this.current = null
      this.candidate = null
    }

    while (this.pending.length > 0 && this.resolvePending(false)) {
      // keep going while attacks have enough audio after them
    }
    if (this.pending.length > 0) return

    if (!audible) {
      this.current = null
      this.candidate = null
      return
    }
    if (++this.hopsSinceTrack >= 4) {
      this.hopsSinceTrack = 0
      this.trackPitchChange()
    }
  }

  /**
   * Reads the pitch of the oldest waiting attack if enough audio has
   * arrived after it (or `force` is set). Returns whether it was handled.
   */
  private resolvePending(force: boolean): boolean {
    const onset = this.pending[0]
    const start = onset + Math.round(SKIP_SEC * this.sampleRate)
    // The analysis ends at the next attack, if one came soon after.
    const limit = this.pending.length > 1 ? this.pending[1] : this.frames
    let length = Math.min(FFT_SIZE, limit - start)
    if (this.pending.length === 1 && length < FFT_SIZE && !force) return false
    this.pending.shift()
    if (length < MIN_ANALYSIS) return true

    const after = magnitudeSpectrum(this.copy(start, length))
    const beforeLength = Math.min(length, onset - Math.max(0, this.frames - RING), onset)
    const added = after
    if (beforeLength >= MIN_ANALYSIS) {
      const before = magnitudeSpectrum(this.copy(onset - beforeLength, beforeLength))
      for (let i = 0; i < added.length; i++) added[i] = Math.max(0, after[i] - before[i])
    }
    // Drop the faint remainder so only what the attack clearly added counts.
    let peak = 0
    for (let i = 0; i < added.length; i++) if (added[i] > peak) peak = added[i]
    const floor = peak * 0.08
    for (let i = 0; i < added.length; i++) if (added[i] < floor) added[i] = 0

    const midi = likelyPitches(added, this.sampleRate)
    if (midi.length > 0) {
      this.current = { midi: midi[0], confirmed: false }
      this.onNote({ timeSec: onset / this.sampleRate, midi })
    }
    return true
  }

  /** Between attacks, watches a single ringing note for a move to another pitch. */
  private trackPitchChange(): void {
    const window = this.copy(this.frames - TRACK_WINDOW, TRACK_WINDOW)
    const [hz, clarity] = this.tracker.findPitch(window, this.sampleRate)
    if (clarity < this.options.clarity || hz < 38 || hz > 1500) {
      this.candidate = null
      return
    }
    const midi = frequencyToMidi(hz)
    if (!this.current) {
      // Sound without a detected attack, such as a note that was already ringing.
      this.current = { midi, confirmed: true }
      return
    }
    const distance = Math.abs(midi - this.current.midi)
    if (distance < 0.8) {
      this.current.confirmed = true
      this.candidate = null
      return
    }
    // Only follow a note that was heard cleanly on its own, and only to a
    // nearby pitch; anything else is several strings sounding together.
    if (!this.current.confirmed || distance > 5.5) {
      this.candidate = null
      return
    }
    if (this.candidate && Math.abs(midi - this.candidate.midi) < 0.4) {
      const frame = this.candidate.frame
      this.candidate = null
      this.current = { midi, confirmed: true }
      if (frame - this.lastNoteFrame >= this.options.minGapSec * this.sampleRate) {
        this.lastNoteFrame = frame
        this.onNote({ timeSec: frame / this.sampleRate, midi: [midi] })
      }
    } else {
      // The reading describes the middle of its window.
      this.candidate = { midi, frame: this.frames - TRACK_WINDOW / 2 }
    }
  }

  private copy(start: number, length: number): Float32Array {
    const out = new Float32Array(length)
    for (let i = 0; i < length; i++) out[i] = this.ring[(((start + i) % RING) + RING) % RING]
    return out
  }
}
