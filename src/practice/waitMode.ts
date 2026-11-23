import { chordHeard, type ExpectedNote, type PlayedNote, pitchMatches } from './matching'

/** A note as the detector reports it, on the clock of the audio it was fed. */
export interface HeardNote extends Omit<PlayedNote, 'timeMs'> {
  timeSec: number
  /** A change of pitch on a ringing string, with no attack: a hammer-on, pull-off, slide or bend. */
  legato?: boolean
}

/** A note to wait for. */
export interface WaitTarget extends ExpectedNote {
  bar: number
  /** Written so that it may sound without being picked: a hammer-on, pull-off, slide or after a grace note. */
  legato?: boolean
  /** Pitches of grace notes written just before it, which are not wrong notes. */
  grace?: number[]
}

export type WaitOutcome = 'firstTry' | 'retried' | 'skipped'

export interface WaitSummary {
  /** Notes got past, over all passes. */
  notes: number
  firstTry: number
  retried: number
  skipped: number
  /** Times the whole passage was finished. */
  passes: number
  /** Bars that took more than one try, or were skipped, the most troubled first. */
  troubleBars: number[]
}

const PITCH_TOLERANCE = 0.6
/** The same attack is not the next note. */
const AFTER_NOTE_SEC = 0.09
/** Attacks closer together than this are one strum, however many strings it has. */
const STRUM_GAP_SEC = 0.16
/** Just after a right note, the string still ringing can read as something else. */
const SETTLE_SEC = 0.2
/** How long a chord's attacks are given to add up before they count as a wrong try. */
const STRUM_SEC = 0.3
/** How long to wait for what sounded with an attack, which the detector reports a moment later. */
const SOUND_WAIT_SEC = 0.35

const isChord = (note: ExpectedNote) => new Set(note.midi).size > 1

/**
 * Follows a player through notes one at a time, moving on only when the
 * right one is heard. It checks that the right notes sounded on a new
 * attack, not how they were played: telling a pick from a hammer-on, or one
 * string from a strum, is not reliable enough to hold a player back for.
 * Knows nothing of the player or the microphone: it is told what was heard
 * and how far the audio has got.
 */
export class WaitFollower<Target extends WaitTarget> {
  readonly targets: Target[]
  private readonly loop: boolean
  index = 0
  finished = false
  /** What was last heard instead of the wanted note: a pitch, or a chord that was not complete. */
  wrong: number | 'chord' | null = null
  private queue: HeardNote[] = []
  private tried = false
  /** When a chord's first attack that did not make the chord was heard. */
  private doubtSince: number | null = null
  // Starts at the start of the audio: a note already ringing then reads as an attack.
  private acceptedAt = 0
  private inChordStrum = false
  private lastAttackAt = Number.NEGATIVE_INFINITY
  private counts = { notes: 0, firstTry: 0, retried: 0, skipped: 0, passes: 0 }
  private trouble = new Map<number, number>()

  constructor(targets: Target[], loop: boolean) {
    this.targets = targets
    this.loop = loop
  }

  get current(): Target | null {
    return this.finished ? null : (this.targets[this.index] ?? null)
  }

  /** Whether a wrong try has been made at the current note. */
  get hasTried(): boolean {
    return this.tried
  }

  hear(note: HeardNote): void {
    if (!this.finished) this.queue.push(note)
  }

  /**
   * Goes through what was heard, now that the audio has reached `nowSec`.
   * Returns the notes got past, in order, each with how it went.
   */
  settle(nowSec: number): { target: Target; outcome: WaitOutcome }[] {
    const passed: { target: Target; outcome: WaitOutcome }[] = []
    while (this.queue.length > 0 && !this.finished) {
      const heard = this.queue[0]
      const target = this.targets[this.index]
      // What sounded with the attack arrives a moment after it; a chord needs it.
      if (!heard.legato && isChord(target) && heard.present === undefined && nowSec - heard.timeSec < SOUND_WAIT_SEC) break
      this.queue.shift()
      if (heard.legato) {
        // A pitch moving with no pick can be a bend or a finger lifting, so it
        // counts only where the tab has it, and is never a wrong try.
        if (target.legato && !isChord(target) && heard.timeSec - this.acceptedAt >= AFTER_NOTE_SEC && this.fits(target, heard)) {
          passed.push(this.moveOn(this.tried ? 'retried' : 'firstTry', heard.timeSec))
        }
        continue
      }
      const sinceAttack = heard.timeSec - this.lastAttackAt
      this.lastAttackAt = heard.timeSec
      if (sinceAttack >= STRUM_GAP_SEC) this.inChordStrum = false
      // The rest of a strum that has already counted.
      if (this.inChordStrum) continue
      if (heard.timeSec - this.acceptedAt < AFTER_NOTE_SEC) continue
      if (this.fits(target, heard)) {
        passed.push(this.moveOn(this.tried ? 'retried' : 'firstTry', heard.timeSec))
        continue
      }
      if (heard.timeSec - this.acceptedAt < SETTLE_SEC) continue
      if (isChord(target)) {
        this.doubtSince ??= heard.timeSec
      } else if (!target.grace?.some((midi) => pitchMatches(heard.midi, midi, PITCH_TOLERANCE))) {
        this.tried = true
        this.wrong = heard.midi[0] ?? null
      }
    }
    if (this.doubtSince !== null && nowSec - this.doubtSince >= STRUM_SEC) {
      this.tried = true
      this.wrong = 'chord'
      this.doubtSince = null
    }
    return passed
  }

  /** Moves past the current note without it having been played. */
  skip(nowSec: number): { target: Target; outcome: WaitOutcome } | null {
    if (this.finished) return null
    // Anything heard so far was for the note being left.
    this.queue = []
    return this.moveOn('skipped', nowSec)
  }

  summary(): WaitSummary {
    const troubleBars = [...this.trouble.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 3)
      .map(([bar]) => bar)
    return { ...this.counts, troubleBars }
  }

  private fits(target: Target, heard: HeardNote): boolean {
    if (!isChord(target)) return pitchMatches(heard.midi, target.midi[0], PITCH_TOLERANCE)
    return chordHeard(target.midi, heard.present)
  }

  private moveOn(outcome: WaitOutcome, atSec: number): { target: Target; outcome: WaitOutcome } {
    const target = this.targets[this.index]
    this.counts.notes++
    this.counts[outcome]++
    if (outcome !== 'firstTry') this.trouble.set(target.bar, (this.trouble.get(target.bar) ?? 0) + 1)
    this.acceptedAt = atSec
    this.inChordStrum = isChord(target) && outcome !== 'skipped'
    this.tried = false
    this.doubtSince = null
    this.wrong = null
    this.index++
    if (this.index >= this.targets.length) {
      this.counts.passes++
      if (this.loop) this.index = 0
      else this.finished = true
    }
    return { target, outcome }
  }
}
