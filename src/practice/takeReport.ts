import { noteName } from '../tuner/tuning'
import { type DetectedNote, NoteDetector } from './detector'
import type { Mark } from './grades'
import {
  type ExpectedNote,
  type NoteGrade,
  type NoteResult,
  type PlayedNote,
  type PracticeSummary,
  TIMING_LEEWAYS,
  type TimingLeeway,
  estimateLatency,
  matchNotes,
  matchOptionsFor,
  summarize,
} from './matching'

/** One expected note as a saved take's report lists it. */
export interface TakeExpectedNote {
  pass: number
  /** Bar number, counted from 0. */
  bar: number
  tick: number
  midi: number[]
  places: { string: number; fret: number }[]
  timeMs: number
  /** Where the note's sound should be in the recording, the delay included. */
  wavSec: number
  grade: NoteGrade
  offsetMs: number | null
}

/** One note the app heard during the take. */
export interface TakeHeardNote {
  wavSec: number
  timeMs: number
  midi: number[]
  matched: boolean
}

/** The report saved inside a take's WAV file. Only the fields used here are listed. */
export interface TakeReport {
  savedAt?: string
  sampleRate: number
  input?: { label?: string; settings?: unknown }
  savedSec?: number
  speed?: number
  looping?: boolean
  loopMs?: number
  passes?: number
  leeway?: TimingLeeway
  latencyMs: number
  latencySource?: string
  latencySupport?: number | null
  measuredMs?: number | null
  learnedMs?: number | null
  /** Strings on the practised track. Absent in takes saved before it was recorded. */
  strings?: number
  expected: TakeExpectedNote[]
  heard: TakeHeardNote[]
}

/** The report from a decoded take, or null when there is none or it lacks the note lists. */
export function readTakeReport(value: unknown): TakeReport | null {
  if (typeof value !== 'object' || value === null) return null
  const report = value as Partial<TakeReport>
  if (!Array.isArray(report.expected) || !Array.isArray(report.heard)) return null
  if (typeof report.latencyMs !== 'number') return null
  return report as TakeReport
}

/** One way of scoring the take: as the app did then, or with the detector as it is now. */
export interface TakeScoring {
  results: NoteResult[]
  summary: PracticeSummary
  /** Notes heard, as positions in the recording (seconds) and candidate pitches. */
  heard: { wavSec: number; midi: number[] }[]
  /** Where each expected note was looked for in the recording, in seconds. */
  targetSec: number[]
}

export interface TakeAnalysis {
  report: TakeReport
  sampleRate: number
  lengthSec: number
  peak: number
  rms: number
  leeway: TimingLeeway
  /** The delay the current scoring used, and how it was found. */
  latencyMs: number
  latencyFound: 'estimated' | 'saved'
  latencySupport: number | null
  saved: TakeScoring
  current: TakeScoring
}

/** Silence before a note, in ms, for it to count as the first after a break. */
const BREAK_MS = 400
/** How far around a missed note to look for what was heard instead. */
const NEARBY_MS = 150

/**
 * Scores a saved take twice: as the app scored it at the time, from the
 * report, and again by running the current detector over the recording.
 */
export function analyzeTake(
  take: { sampleRate: number; samples: Float32Array; report: TakeReport },
  options: { leeway?: TimingLeeway } = {},
): TakeAnalysis {
  const { sampleRate, samples, report } = take
  let peak = 0
  let power = 0
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample))
    power += sample * sample
  }
  const rms = samples.length > 0 ? Math.sqrt(power / samples.length) : 0

  const savedResults: NoteResult[] = report.expected.map((note) => ({ grade: note.grade, offsetMs: note.offsetMs }))
  const saved: TakeScoring = {
    results: savedResults,
    summary: summarize(savedResults, report.heard.filter((note) => !note.matched).length),
    heard: report.heard.map((note) => ({ wavSec: note.wavSec, midi: note.midi })),
    targetSec: report.expected.map((note) => note.wavSec),
  }

  const found: DetectedNote[] = []
  const detector = new NoteDetector(sampleRate, (note) => found.push(note))
  detector.feed(samples)
  detector.flush()

  const expected: ExpectedNote[] = report.expected.map((note) => ({
    timeMs: note.wavSec * 1000 - report.latencyMs,
    midi: note.midi,
  }))
  const played: PlayedNote[] = found.map((note) => ({ timeMs: note.timeSec * 1000, midi: note.midi, present: note.present }))
  // The default search range (-150 to 800 ms) is widened when the saved delay
  // lies outside it, so the estimate can still land near that delay.
  const estimate = estimateLatency(expected, played, {
    preferMs: report.latencyMs,
    minMs: Math.min(-150, report.latencyMs - 150),
    maxMs: Math.max(800, report.latencyMs + 300),
  })
  const latencyMs = estimate?.latencyMs ?? report.latencyMs
  const leeway = options.leeway ?? report.leeway ?? 'normal'
  const { results, extraNotes } = matchNotes(expected, played, latencyMs, matchOptionsFor(leeway))
  const current: TakeScoring = {
    results,
    summary: summarize(results, extraNotes),
    heard: found.map((note) => ({ wavSec: note.timeSec, midi: note.midi })),
    targetSec: expected.map((note) => (note.timeMs + latencyMs) / 1000),
  }

  return {
    report,
    sampleRate,
    lengthSec: samples.length / sampleRate,
    peak,
    rms,
    leeway,
    latencyMs,
    latencyFound: estimate ? 'estimated' : 'saved',
    latencySupport: estimate?.support ?? null,
    saved,
    current,
  }
}

const GRADE_TEXT: Record<NoteGrade, string> = {
  onTime: 'on time',
  early: 'early',
  late: 'late',
  missed: 'MISSED',
  unscored: 'chord',
}

/** A level from 0 to 1 in decibels, or null for silence. */
export const decibels = (level: number): number | null => (level > 0 ? 20 * Math.log10(level) : null)
/** A level from 0 to 1 as text in decibels. */
export const toDb = (level: number) => {
  const db = decibels(level)
  return db === null ? 'silent' : `${db.toFixed(1)} dB`
}
/** Milliseconds rounded, with a sign: + is late. */
export function signed(ms: number): string {
  const value = Math.round(ms) || 0
  return `${value >= 0 ? '+' : ''}${value}`
}
/** Candidate pitches as note names, such as "A2/A3". */
const pitchNames = (midi: number[]) => midi.map(noteName).join('/')

/** A written note with its strings and frets; string 1 is the lowest. */
function writtenNote(note: TakeExpectedNote): string {
  const names = pitchNames(note.midi)
  const places = note.places.map((place) => `s${place.string} f${place.fret}`).join(', ')
  return places ? `${names} ${places}` : names
}

function gradeText(result: NoteResult): string {
  const grade = GRADE_TEXT[result.grade]
  return result.offsetMs === null ? grade : `${grade} ${signed(result.offsetMs)}`
}

/** What a scoring heard within NEARBY_MS of a missed note, or an empty string for any other note. */
function heardInstead(scoring: TakeScoring, index: number): string {
  if (scoring.results[index].grade !== 'missed') return ''
  const target = scoring.targetSec[index]
  const near = scoring.heard
    .map((note) => ({ ms: (note.wavSec - target) * 1000, midi: note.midi }))
    .filter((note) => Math.abs(note.ms) <= NEARBY_MS)
  if (near.length === 0) return 'nothing heard'
  return near.map((note) => `${pitchNames(note.midi)} ${signed(note.ms)} ms`).join('; ')
}

function summaryLine(name: string, summary: PracticeSummary, heard: number): string {
  const typical = summary.typicalOffsetMs === null ? 'none' : `${Math.round(summary.typicalOffsetMs)} ms`
  return (
    `${name.padEnd(24)}${summary.scored} scored: ${summary.onTime} on time, ${summary.early} early, ` +
    `${summary.late} late, ${summary.missed} missed; accuracy ${Math.round(summary.accuracy * 100)} %; ` +
    `${heard} heard, ${summary.extraNotes} extra; typical offset ${typical}`
  )
}

function table(rows: string[][], rightAligned: Set<number>): string[] {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)))
  return rows.map((row) =>
    row
      .map((cell, column) => (rightAligned.has(column) ? cell.padStart(widths[column]) : cell.padEnd(widths[column])))
      .join('  ')
      .trimEnd(),
  )
}

/** Notes whose grade differs between the saved and the current scoring, as row numbers from 1. */
export function changedNotes(analysis: TakeAnalysis): number[] {
  return analysis.report.expected.flatMap((_, i) =>
    analysis.saved.results[i].grade !== analysis.current.results[i].grade ? [i + 1] : [],
  )
}

/** The analysis as plain text for a terminal. */
export function formatTakeAnalysis(analysis: TakeAnalysis): string {
  const { report, saved, current } = analysis
  const lines: string[] = []
  const label = (text: string) => text.padEnd(24)
  const leewayLabel = (id: TimingLeeway | undefined) => TIMING_LEEWAYS.find((item) => item.id === id)?.label ?? 'unknown'

  lines.push('Saved take')
  lines.push(`${label('Saved')}${report.savedAt ?? 'unknown'}`)
  lines.push(`${label('Input')}${report.input?.label || 'unknown'}`)
  lines.push(`${label('Sample rate')}${analysis.sampleRate} Hz`)
  lines.push(`${label('Recording length')}${analysis.lengthSec.toFixed(2)} s`)
  let level = `peak ${toDb(analysis.peak)}, RMS ${toDb(analysis.rms)}`
  if (analysis.peak >= 0.99) level += '  WARNING: the input clipped; turn the gain down'
  else if (analysis.peak < 0.05) level += '  WARNING: very quiet input; turn the gain up'
  lines.push(`${label('Level')}${level}`)
  lines.push(`${label('Tempo factor')}${report.speed ?? 1}`)
  let timing = leewayLabel(analysis.leeway)
  if (report.leeway && report.leeway !== analysis.leeway) timing += ` (the take used ${leewayLabel(report.leeway)})`
  lines.push(`${label('Timing')}${timing}`)
  const support = report.latencySupport ? `, ${report.latencySupport} notes agreed` : ''
  lines.push(`${label('Delay at the time')}${Math.round(report.latencyMs)} ms (${report.latencySource ?? 'unknown'}${support})`)
  lines.push(
    `${label('Delay now')}${Math.round(analysis.latencyMs)} ms (` +
      (analysis.latencyFound === 'estimated'
        ? `estimated from the playing, ${analysis.latencySupport} notes agreed)`
        : 'too few notes to estimate; the saved delay is used)'),
  )
  if (report.looping) lines.push(`${label('Loop')}${report.passes ?? '?'} passes`)

  lines.push('')
  lines.push('Summary')
  lines.push(summaryLine('As saved', saved.summary, saved.heard.length))
  lines.push(summaryLine('With current detector', current.summary, current.heard.length))

  lines.push('')
  lines.push('Notes (string 1 is the lowest; offsets in ms, + is late)')
  const looped = !!report.looping
  const header = ['#', ...(looped ? ['Pass'] : []), 'Bar', 'Written', 'At (s)', 'As saved', 'Now', 'Heard instead (saved)', 'Heard instead (now)']
  const rows = report.expected.map((note, i) => [
    `${i + 1}`,
    ...(looped ? [`${note.pass + 1}`] : []),
    `${note.bar + 1}`,
    writtenNote(note),
    note.wavSec.toFixed(3),
    gradeText(saved.results[i]),
    gradeText(current.results[i]),
    heardInstead(saved, i),
    heardInstead(current, i),
  ])
  const right = new Set(['#', 'Pass', 'Bar', 'At (s)'].map((name) => header.indexOf(name)))
  lines.push(...table([header, ...rows], right))

  lines.push('')
  lines.push('Patterns (current detector)')
  const missedOn = new Map<number, number>()
  const totalOn = new Map<number, number>()
  const afterBreak = { missed: 0, total: 0 }
  const rest = { missed: 0, total: 0 }
  report.expected.forEach((note, i) => {
    const grade = current.results[i].grade
    if (grade === 'unscored') return
    const missed = grade === 'missed' ? 1 : 0
    for (const place of note.places) {
      totalOn.set(place.string, (totalOn.get(place.string) ?? 0) + 1)
      missedOn.set(place.string, (missedOn.get(place.string) ?? 0) + missed)
    }
    const previous = report.expected[i - 1]
    const isFirst = !previous || (note.wavSec - previous.wavSec) * 1000 >= BREAK_MS
    const group = isFirst ? afterBreak : rest
    group.missed += missed
    group.total++
  })
  const strings = [...totalOn.keys()].sort((a, b) => a - b)
  lines.push(
    `${label('Misses per string')}` +
      (strings.length > 0 ? strings.map((s) => `s${s} ${missedOn.get(s)}/${totalOn.get(s)}`).join(', ') : 'none'),
  )
  lines.push(`${label('First after a break')}${afterBreak.missed}/${afterBreak.total} missed (${BREAK_MS} ms or more without a note before it)`)
  lines.push(`${label('Other notes')}${rest.missed}/${rest.total} missed`)
  const changed = changedNotes(analysis)
  lines.push(
    `${label('Grade differs')}` +
      (changed.length > 0
        ? changed.map((n) => `#${n} ${GRADE_TEXT[saved.results[n - 1].grade]} -> ${GRADE_TEXT[current.results[n - 1].grade]}`).join(', ')
        : 'no note'),
  )
  return lines.join('\n')
}

/** Peak and RMS level, from 0 to 1, of a recording kept in blocks. */
export function inputLevel(blocks: Float32Array[]): { peak: number; rms: number } {
  let peak = 0
  let power = 0
  let count = 0
  for (const block of blocks) {
    for (let i = 0; i < block.length; i++) {
      const sample = block[i]
      const size = Math.abs(sample)
      if (size > peak) peak = size
      power += sample * sample
    }
    count += block.length
  }
  return { peak, rms: count > 0 ? Math.sqrt(power / count) : 0 }
}

/** One scored note of a take, as the in-app report shows it. */
export interface TakeDetailsRow {
  /** Position in the take's list of notes, from 1. */
  number: number
  /** Time round the loop, from 1. */
  pass: number
  /** Bar number, from 1. */
  bar: number
  /** The written pitch, such as "A2". */
  written: string
  /** Where it is played, such as "string 5, fret 0". */
  place: string
  grade: Mark
  offsetMs: number | null
  /** The offset in words, such as "12 ms early"; a dash for a missed note. */
  timing: string
  /** For a missed note, what was heard near it instead; empty for other notes. */
  heardInstead: string
}

/** Everything the in-app report of a take shows, as plain values. */
export interface TakeDetails {
  inputLabel: string | null
  peakDb: number | null
  rmsDb: number | null
  warning: 'clipping' | 'quiet' | null
  latencyMs: number
  latencySource: string | null
  leeway: TimingLeeway
  looping: boolean
  summary: PracticeSummary
  rows: TakeDetailsRow[]
  /** Misses per string that has scored notes, highest string first. */
  byString: { label: string; missed: number; total: number }[]
  /** Chords left unscored, in takes saved before chords were scored. */
  chords: number
}

/** How the delay used for scoring was found, in words, by the source a take reports. */
export const DELAY_SOURCE_TEXT: Record<string, string> = {
  measured: 'measured for this input',
  estimated: 'worked out from your playing',
  remembered: 'remembered from your last take',
  none: 'not enough notes to work out the delay',
}

/** An offset in words: "12 ms early", "30 ms late" or "on the beat". */
function timingText(ms: number): string {
  const value = Math.round(ms)
  if (Math.abs(value) < 5) return 'on the beat'
  return `${Math.abs(value)} ms ${value < 0 ? 'early' : 'late'}`
}

/**
 * A string's name as players count them, string 1 being the highest, when the
 * number of strings is known; otherwise counted from the lowest as saved.
 */
function stringLabel(string: number, strings: number | undefined): string {
  return strings ? `string ${strings + 1 - string}` : `string ${string} from the lowest`
}

/** Turns a saved take's report and its input level into what the in-app report shows. */
export function describeTake(report: TakeReport, level: { peak: number; rms: number }): TakeDetails {
  const results: NoteResult[] = report.expected.map((note) => ({ grade: note.grade, offsetMs: note.offsetMs }))
  const unmatched = report.heard.filter((note) => note.matched === false)
  const strings = report.strings && report.strings > 0 ? report.strings : undefined

  const rows: TakeDetailsRow[] = []
  const totals = new Map<number, { missed: number; total: number }>()
  report.expected.forEach((note, index) => {
    if (note.grade === 'unscored') return
    const missed = note.grade === 'missed'
    let heardInstead = ''
    if (missed) {
      const near = unmatched
        .map((heard) => ({ ms: (heard.wavSec - note.wavSec) * 1000, midi: heard.midi }))
        .filter((heard) => heard.midi.length > 0 && Math.abs(heard.ms) <= NEARBY_MS)
        .sort((a, b) => Math.abs(a.ms) - Math.abs(b.ms))
      heardInstead =
        near.length > 0 ? near.map((heard) => `${noteName(heard.midi[0])}, ${timingText(heard.ms)}`).join('; ') : 'nothing heard'
    }
    for (const place of note.places) {
      const tally = totals.get(place.string) ?? { missed: 0, total: 0 }
      tally.total++
      if (missed) tally.missed++
      totals.set(place.string, tally)
    }
    rows.push({
      number: index + 1,
      pass: note.pass + 1,
      bar: note.bar + 1,
      written: pitchNames(note.midi),
      place: note.places.map((place) => `${stringLabel(place.string, strings)}, fret ${place.fret}`).join('; '),
      grade: note.grade,
      offsetMs: note.offsetMs,
      timing: note.offsetMs === null ? '–' : timingText(note.offsetMs),
      heardInstead,
    })
  })

  return {
    inputLabel: report.input?.label || null,
    peakDb: decibels(level.peak),
    rmsDb: decibels(level.rms),
    warning: level.peak >= 0.99 ? 'clipping' : level.peak < 0.05 ? 'quiet' : null,
    latencyMs: report.latencyMs,
    latencySource: report.latencySource ?? null,
    leeway: report.leeway ?? 'normal',
    looping: !!report.looping,
    summary: summarize(results, unmatched.length),
    rows,
    byString: [...totals.entries()]
      .sort(([a], [b]) => b - a)
      .map(([string, tally]) => ({ label: stringLabel(string, strings), ...tally })),
    chords: report.expected.filter((note) => note.grade === 'unscored').length,
  }
}
