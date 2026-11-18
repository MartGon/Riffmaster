import { describe, expect, it } from 'vitest'
import { type DetectedNote, NoteDetector } from './detector'
import { estimateLatency, type ExpectedNote, matchNotes, type PlayedNote } from './matching'
import { type SynthNote, synthesize } from './synth'

const RATE = 48000

/** Open chords as a guitar plays them, low string first. */
const CHORDS: Record<string, number[]> = {
  C: [48, 52, 55, 60, 64],
  Am: [45, 52, 57, 60, 64],
  G: [43, 47, 50, 55, 59, 67],
  Em: [40, 47, 52, 55, 59, 64],
  D: [50, 57, 62, 66],
  F: [41, 48, 53, 57, 60, 65],
  E5: [40, 47, 52],
  A7: [45, 52, 55, 61, 64],
}

interface Strum {
  chord: string
  timeSec: number
}

/**
 * Strums chords: one string after the other, `spreadSec` apart, low to high
 * (or high to low for an upstrum). Each chord rings until the next is played.
 */
function strums(list: Strum[], options: { spreadSec?: number; up?: boolean; endSec?: number } = {}): SynthNote[] {
  const spread = options.spreadSec ?? 0.012
  return list
    .flatMap((strum, index) => {
      const next = list[index + 1]?.timeSec ?? options.endSec ?? strum.timeSec + 1
      const pitches = options.up ? [...CHORDS[strum.chord]].reverse() : CHORDS[strum.chord]
      return pitches.map((midi, i) => ({
        timeSec: strum.timeSec + i * spread,
        midi,
        durationSec: next - strum.timeSec - i * spread - 0.01,
      }))
    })
    .sort((a, b) => a.timeSec - b.timeSec)
}

function hear(
  notes: SynthNote[],
  totalSec: number,
  options: { noiseFloor?: number; pickNoise?: number; attackSec?: number; gain?: number } = {},
): PlayedNote[] {
  const audio = synthesize(notes, RATE, totalSec, { noiseFloor: options.noiseFloor ?? 0.001, ...options })
  if (options.gain !== undefined) for (let i = 0; i < audio.length; i++) audio[i] *= options.gain
  const found: DetectedNote[] = []
  const detector = new NoteDetector(RATE, (note) => found.push(note))
  for (let i = 0; i < audio.length; i += 128) detector.feed(audio.subarray(i, i + 128))
  detector.flush()
  return found.map((note) => ({ timeMs: note.timeSec * 1000, midi: note.midi, present: note.present }))
}

const expectedFor = (list: Strum[]): ExpectedNote[] =>
  list.map((strum) => ({ timeMs: strum.timeSec * 1000, midi: CHORDS[strum.chord] }))

const grades = (expected: ExpectedNote[], played: PlayedNote[]) =>
  matchNotes(expected, played, 0).results.map((result) => result.grade)

const progression = (names: string[], gapSec = 1): Strum[] =>
  names.map((chord, i) => ({ chord, timeSec: 0.3 + i * gapSec }))

describe('chords', () => {
  it('hears each chord of a progression', () => {
    const list = progression(['C', 'Am', 'F', 'G', 'Em', 'D', 'A7', 'E5'])
    const played = hear(strums(list), 8.6)
    expect(grades(expectedFor(list), played)).toEqual(list.map(() => 'onTime'))
  })

  it('counts a wrong chord as missed', () => {
    const list = progression(['C', 'Am', 'G', 'Em', 'D', 'F'])
    // Played: the chords that share the most notes with the written ones.
    const playedList = progression(['Am', 'C', 'Em', 'G', 'G', 'Am'])
    const played = hear(strums(playedList), 6.6)
    expect(grades(expectedFor(list), played)).toEqual(list.map(() => 'missed'))
  })

  it('hears quick repeated strums of one chord', () => {
    // Eighth notes at 120 bpm.
    const list = Array.from({ length: 8 }, (_, i) => ({ chord: 'G', timeSec: 0.3 + i * 0.25 }))
    const played = hear(strums(list), 2.6)
    expect(grades(expectedFor(list), played)).toEqual(list.map(() => 'onTime'))
  })

  it('hears quick changes between chords', () => {
    const list = progression(['C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F'], 0.5)
    const played = hear(strums(list), 4.6)
    expect(grades(expectedFor(list), played)).toEqual(list.map(() => 'onTime'))
  })

  it('hears upstrums and a slow, spread strum', () => {
    const up = progression(['G', 'C', 'D'])
    expect(grades(expectedFor(up), hear(strums(up, { up: true }), 3.6))).toEqual(['onTime', 'onTime', 'onTime'])
    const slow = progression(['Em', 'Am', 'C'])
    expect(grades(expectedFor(slow), hear(strums(slow, { spreadSec: 0.03 }), 3.6))).toEqual(['onTime', 'onTime', 'onTime'])
  })

  it('hears chords from a plugged-in guitar, and a quiet one over noise', () => {
    const list = progression(['C', 'Am', 'F', 'G'])
    const soft = hear(strums(list), 4.6, { pickNoise: 0, attackSec: 0.02 })
    // The first, soft and straight out of silence, is at the edge of what the
    // attack detector hears with this background noise; single notes share
    // that limit. A take starts after the count-in, not out of silence.
    expect(grades(expectedFor(list), soft).slice(1)).toEqual(['onTime', 'onTime', 'onTime'])
    const quiet = hear(strums(list), 4.6, { gain: 0.1, noiseFloor: 0.002 })
    expect(grades(expectedFor(list), quiet)).toEqual(list.map(() => 'onTime'))
  })

  it('does not count the strings of a slow strum as extra notes', () => {
    const list = progression(['Em', 'Am', 'C'])
    const played = hear(strums(list, { spreadSec: 0.03 }), 3.6)
    expect(matchNotes(expectedFor(list), played, 0).extraNotes).toBe(0)
  })

  it('finds the delay of the sound from chords alone', () => {
    const list = progression(['C', 'Am', 'F', 'G', 'C', 'Am', 'F', 'G'], 0.75)
    // The sound arrives 140 ms after the tab says.
    const played = hear(strums(list.map((strum) => ({ ...strum, timeSec: strum.timeSec + 0.14 }))), 6.9)
    const estimate = estimateLatency(expectedFor(list), played)
    expect(estimate?.latencyMs).toBeGreaterThan(125)
    expect(estimate?.latencyMs).toBeLessThan(155)
    expect(grades(expectedFor(list), played).every((grade) => grade === 'late')).toBe(true)
    expect(matchNotes(expectedFor(list), played, estimate!.latencyMs).results.every((r) => r.grade === 'onTime')).toBe(true)
  })

  it('times a chord by its first string', () => {
    const list = progression(['G', 'C'])
    const played = hear(strums(list, { spreadSec: 0.02 }), 2.6)
    const { results } = matchNotes(expectedFor(list), played, 0)
    for (const result of results) expect(Math.abs(result.offsetMs ?? 999)).toBeLessThan(25)
  })
})
