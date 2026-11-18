import { PitchDetector } from 'pitchy'
import { CHORD_FFT_SIZE, FFT_SIZE, FLUX_AHEAD, FluxMeter, likelyPitches, magnitudeSpectrum, magnitudeSpectrumOf, presentNotes } from './spectrum'

export interface DetectedNote {
  /** Position of the note's start, in seconds of audio fed to the detector. */
  timeSec: number
  /**
   * MIDI pitches the note could be, the most likely first. Usually one;
   * a second appears when the octave is ambiguous.
   */
  midi: number[]
  /**
   * For an attack: every note whose sound shows just after it, low to high,
   * including strings still ringing. Used to tell whether a chord was
   * played. Missing for a note found as a change of pitch without an attack.
   */
  present?: number[]
}

export interface DetectorOptions {
  /** Signal below this level (dB relative to full scale) is treated as silence. */
  gateDb: number
  /** How much new sound an attack must add; see FluxMeter. */
  onsetFlux: number
  /** The same for the long window, which backs the short one up. */
  onsetFluxLong: number
  /** How far an attack must stand above the usual flux of the last moments, as a factor. */
  onsetRatio: number
  /** Shortest time between two notes, in seconds. */
  minGapSec: number
  /** How sure a pitch reading must be, from 0 to 1, to follow hammer-ons and slides. */
  clarity: number
}

export const defaultDetectorOptions: DetectorOptions = {
  gateDb: -50,
  onsetFlux: 8,
  onsetFluxLong: 12,
  onsetRatio: 4,
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
/** Hops an attack waits, so that it is known to be the peak of its surroundings. */
const PEAK_REACH = 3
/** Hops of flux history the usual level is taken from, about 200 ms at 48 kHz. */
const FLUX_MEMORY = 40
/** The short window, which times attacks, and the long one, which backs it up, in samples. */
const TIME_WINDOW = 1024
const FIND_WINDOW = 2048
/** From the start of the short window whose flux peaks to the attack itself, in samples. */
const ONSET_BACK = 480
/** Longest a strum takes from its first string to its last, in seconds. */
export const STRUM_SEC = 0.1
/** Hops the long window waits for the short one to report the same attack. */
const SECOND_WAIT = 6

export function frequencyToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440)
}

const toDb = (power: number) => 10 * Math.log10(power + 1e-12)

/**
 * Turns a stream of mono audio into note events for a single-note line.
 *
 * A picked note is found by its attack: a moment that adds new partials to
 * the sound, which also shows while other strings ring on. Its pitch is read from what the attack
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
  private readonly timer: FluxMeter
  private readonly finder: FluxMeter
  /** Flux of the latest hops through the short and the long window, oldest first. */
  private readonly fine: number[] = []
  private readonly coarse: number[] = []
  /** An attack only the long window has seen so far, as the end of its window. */
  private second: number | null = null
  /** Whether each of those hops was above the silence gate. */
  private readonly loud: boolean[] = []
  private lastNoteFrame = -RING
  /** The latest attacks, as sample positions, oldest first. */
  private readonly attacks: number[] = []
  /** Attacks whose pitch has not been read yet, as sample positions, oldest first. */
  private readonly pending: number[] = []
  /** The note currently ringing, when a plain pitch reading agrees with it. */
  private current: { midi: number; confirmed: boolean } | null = null
  /** A different pitch seen once, waiting for a second reading to confirm it. */
  private candidate: { midi: number; frame: number } | null = null
  private hopsSinceTrack = 0
  /**
   * Attacks whose chord reading (`present`) waits for more audio: it takes
   * a longer stretch than the pitch, so the note is reported first and the
   * reading added to it a moment later.
   */
  private readonly chords: { note: DetectedNote; start: number }[] = []

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
    this.timer = new FluxMeter(sampleRate, TIME_WINDOW, 2)
    this.finder = new FluxMeter(sampleRate, FIND_WINDOW, 4)
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

  /** Whether the flux at one hop is an attack: a peak, loud enough, and unlike what came before. */
  private isPeak(flux: number[], at: number, least: number): boolean {
    if (at < PEAK_REACH) return false
    const value = flux[at]
    // Sound must follow: hiss and hum also flicker, far below the gate.
    if (value < least || !this.loud.slice(at).some(Boolean)) return false
    for (let i = at - PEAK_REACH; i <= at + PEAK_REACH; i++) {
      // Of two equal neighbours the earlier one is the peak.
      if (i !== at && (i < at ? flux[i] >= value : flux[i] > value)) return false
    }
    const earlier = flux.slice(0, at - PEAK_REACH).sort((a, b) => a - b)
    const usual = earlier.length > 0 ? earlier[earlier.length >> 1] : 0
    return value >= usual * this.options.onsetRatio
  }

  private attack(onset: number): void {
    this.attacks.push(onset)
    if (this.attacks.length > 16) this.attacks.shift()
    this.lastNoteFrame = onset
    this.pending.push(onset)
    this.current = null
    this.candidate = null
  }

  /** Reads the pitch of attacks still waiting for more audio. Call when the audio ends. */
  flush(): void {
    while (this.pending.length > 0) this.resolvePending(true)
    while (this.chords.length > 0) this.resolveChord(true)
  }

  /**
   * Adds the chord reading to the oldest attack waiting for one, once the
   * stretch after it has arrived (or `force` is set). A chord is judged by
   * all of its sound after the strum, not only what the strum added: notes
   * it shares with the chord before ring on, and would hardly show as added.
   * The stretch ends at the next attack. Returns whether it was handled.
   */
  private resolveChord(force: boolean): boolean {
    const { note, start } = this.chords[0]
    // The strings of one strum can be heard as attacks of their own; only
    // an attack well after this one starts something else.
    const next = this.nextAttackAfter(start + STRUM_SEC * this.sampleRate)
    const limit = next ?? this.frames
    const length = Math.min(CHORD_FFT_SIZE, limit - start, RING)
    if (next === null && length < CHORD_FFT_SIZE && !force) return false
    this.chords.shift()
    if (length >= MIN_ANALYSIS) note.present = presentNotes(magnitudeSpectrumOf(this.copy(start, length), CHORD_FFT_SIZE), this.sampleRate, CHORD_FFT_SIZE)
    return true
  }

  /** The first attack after a sample position, among those already found. */
  private nextAttackAfter(position: number): number | null {
    for (const onset of this.attacks) if (onset > position) return onset
    return null
  }

  private processHop(): void {
    const { hop, ring, options } = this
    const hopStart = this.frames
    for (let i = 0; i < HOP; i++) ring[(hopStart + i) % RING] = hop[i]
    this.frames += HOP

    let power = 0
    for (let i = 0; i < HOP; i++) power += hop[i] * hop[i]
    const audible = toDb(power / HOP) > options.gateDb

    // An attack is a peak of the flux: higher than the hops around it, and
    // well above what the sound has been doing lately. It is judged a few
    // hops late, once the hops after it are known.
    const { fine, coarse } = this
    fine.push(this.timer.next(this.copy(this.frames - TIME_WINDOW, TIME_WINDOW)))
    coarse.push(this.finder.next(this.copy(this.frames - FIND_WINDOW, FIND_WINDOW)))
    this.loud.push(audible)
    if (fine.length > FLUX_MEMORY + 2 * PEAK_REACH + 1) {
      fine.shift()
      coarse.shift()
      this.loud.shift()
    }
    const at = fine.length - 1 - PEAK_REACH
    // The end of the windows whose flux is being judged.
    const judged = this.frames - (PEAK_REACH + FLUX_AHEAD) * HOP
    const minGap = options.minGapSec * this.sampleRate

    // The short window places an attack in time, and finds nearly all of them.
    if (this.isPeak(fine, at, options.onsetFlux)) {
      const onset = Math.max(0, judged - TIME_WINDOW + ONSET_BACK)
      if (onset - this.lastNoteFrame >= minGap) this.attack(onset)
    }
    // The long window tells low notes apart, so it also hears a low note
    // that joins strings still ringing. It is only a second opinion: it
    // waits a moment for the short window to report the same attack.
    if (this.isPeak(coarse, at, options.onsetFluxLong)) this.second = judged
    if (this.second !== null && this.frames - this.second >= SECOND_WAIT * HOP) {
      const end = this.second
      this.second = null
      if (this.lastNoteFrame < end - FIND_WINDOW - minGap) {
        // Timed by where the short window saw the most within that stretch.
        let best = -1
        for (let i = 0; i < fine.length; i++) {
          const windowEnd = this.frames - (fine.length - 1 - i + FLUX_AHEAD) * HOP
          if (windowEnd < end - FIND_WINDOW + TIME_WINDOW || windowEnd > end + 2 * HOP) continue
          if (best < 0 || fine[i] > fine[best]) best = i
        }
        if (best >= 0) {
          const windowEnd = this.frames - (fine.length - 1 - best + FLUX_AHEAD) * HOP
          this.attack(Math.max(0, windowEnd - TIME_WINDOW + ONSET_BACK))
        }
      }
    }

    while (this.pending.length > 0 && this.resolvePending(false)) {
      // keep going while attacks have enough audio after them
    }
    while (this.chords.length > 0 && this.resolveChord(false)) {
      // the same for chord readings
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
    const added = Float64Array.from(after)
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
      const note: DetectedNote = { timeSec: onset / this.sampleRate, midi }
      this.chords.push({ note, start })
      this.onNote(note)
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
