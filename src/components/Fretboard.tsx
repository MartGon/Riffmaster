import type * as alphaTab from '@coderline/alphatab'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Fingerings } from '../fingering/fromScore'
import { fretSpan, INLAY_FRETS, neckDots, type NeckDot } from '../fretboard/layout'
import type { TrackInfo } from '../player/usePlayer'
import { pitchClassName } from '../tuner/tuning'

type Beat = alphaTab.model.Beat

interface Props {
  api: alphaTab.AlphaTabApi | null
  track: TrackInfo | undefined
  isPlaying: boolean
  /** Playback position in ticks; while paused the fretboard shows the beat there. */
  tick: number
  /** Fingers to show in the dots in place of note names; null when fingering is off. */
  fingerings: Fingerings | null
  /** Semitones the song is shifted by; notes are named as they sound. */
  pitch?: number
}

const ROW = 19
const TOP = 12
const LABELS = 22
const OPEN = 26

/** The next beat with notes after `beat`, looking a few beats ahead. */
function upcoming(beat: Beat): Beat | null {
  let next = beat.nextBeat
  for (let i = 0; next && i < 8; i++, next = next.nextBeat) {
    if (!next.isRest && next.notes.length > 0) return next
  }
  return null
}

/** A neck diagram showing where the notes being played sit, and where the next ones are. */
export function Fretboard({ api, track, isPlaying, tick, fingerings, pitch = 0 }: Props) {
  const [played, setPlayed] = useState<Beat | null>(null)
  const [width, setWidth] = useState(0)
  /** Counts loaded songs, so what depends on the song is worked out again. */
  const [songCount, setSongCount] = useState(0)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!api) return
    const onBeat = (beat: Beat) => setPlayed(beat)
    const onScore = () => {
      setPlayed(null)
      setSongCount((count) => count + 1)
    }
    api.playedBeatChanged.on(onBeat)
    api.scoreLoaded.on(onScore)
    return () => {
      api.playedBeatChanged.off(onBeat)
      api.scoreLoaded.off(onScore)
    }
  }, [api])

  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth - 28))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const trackIndex = track?.index
  const capo = track?.capo ?? 0
  const frets = useMemo(() => {
    void songCount
    const staff = api?.score?.tracks.find((t) => t.index === trackIndex)?.staves[0]
    let highest = 0
    for (const bar of staff?.bars ?? []) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          for (const note of beat.notes) highest = Math.max(highest, note.fret + capo)
        }
      }
    }
    return fretSpan(highest)
  }, [api, trackIndex, capo, songCount])

  // While the song plays alphaTab reports each beat as it sounds. While it
  // is paused nothing is reported, so the beat is looked up from the position.
  const resting = useMemo(() => {
    void songCount
    if (isPlaying || trackIndex === undefined) return null
    return api?.tickCache?.findBeat(new Set([trackIndex]), tick)?.beat ?? null
  }, [api, isPlaying, tick, trackIndex, songCount])

  const strings = track?.tuning.length ?? 0
  if (!track || track.percussion || strings === 0) {
    return (
      <div className="fretboard" ref={container}>
        <p className="practice-message">There is no fretboard to show for this track.</p>
      </div>
    )
  }

  // A beat of another track can linger for a moment after switching tracks.
  const current = isPlaying ? played : resting
  const beat = current && current.voice.bar.staff.track.index === track.index ? current : null
  const now: NeckDot[] = beat ? neckDots(beat.notes, strings, capo) : []
  const nextBeat = beat ? upcoming(beat) : null
  const next = nextBeat
    ? neckDots(nextBeat.notes, strings, capo).filter(
        (dot) => !now.some((other) => other.row === dot.row && other.fret === dot.fret),
      )
    : []

  const nut = LABELS + OPEN
  const fretWidth = Math.min(52, Math.max(15, (Math.max(width, 280) - nut - 10) / frets))
  const total = nut + frets * fretWidth + 10
  const height = TOP + strings * ROW + 16
  const rowY = (row: number) => TOP + row * ROW + ROW / 2
  const dotX = (fret: number) => (fret === 0 ? LABELS + OPEN / 2 : nut + (fret - 0.5) * fretWidth)
  const radius = Math.min(8, fretWidth / 2 - 1.5)
  const neckTop = rowY(0)
  const neckBottom = rowY(strings - 1)
  const fingerOf = (dot: NeckDot) => (dot.fret > capo ? fingerings?.get(dot.id) : undefined)
  const fingerName = (finger: number | 'T') => (finger === 'T' ? 'thumb' : `finger ${finger}`)
  /** What is written in a dot: the finger when fingering is on, else the note's name. */
  const dotLabel = (dot: NeckDot) => {
    if (dot.dead) return '×'
    if (!fingerings) return pitchClassName(dot.midi + pitch)
    // 0 is the usual sign for an open string.
    return dot.fret <= capo ? '0' : String(fingerOf(dot)?.finger ?? '')
  }
  // The four frets the hand covers, starting at the index finger.
  const hand = now.map((dot) => fingerOf(dot)?.position).find((position) => position != null) ?? null
  // The band always takes in the notes being fretted, also one reached from outside the position.
  const fingered = now.filter((dot) => fingerOf(dot)).map((dot) => dot.fret)
  const handFrom = hand === null ? 0 : Math.max(1, Math.min(hand, ...fingered))
  const handTo = hand === null ? 0 : Math.min(frets, Math.max(hand + 3, ...fingered))
  const described = now.length
    ? now
        .map((dot) => {
          const finger = fingerOf(dot)
          return `${pitchClassName(dot.midi + pitch)} on string ${dot.row + 1}, ${dot.fret === 0 ? 'open' : `fret ${dot.fret}`}${finger ? `, ${fingerName(finger.finger)}` : ''}`
        })
        .join('; ')
    : 'no notes sounding'

  return (
    <div className="fretboard" ref={container}>
      <svg width={total} height={height} role="img" aria-label={`Fretboard: ${described}`}>
        {INLAY_FRETS.filter((fret) => fret <= frets).map((fret) => (
          <g key={fret}>
            {fret % 12 === 0 ? (
              <>
                <circle className="neck-inlay" cx={dotX(fret)} cy={(neckTop + neckBottom) / 2 - ROW} r={3} />
                <circle className="neck-inlay" cx={dotX(fret)} cy={(neckTop + neckBottom) / 2 + ROW} r={3} />
              </>
            ) : (
              <circle className="neck-inlay" cx={dotX(fret)} cy={(neckTop + neckBottom) / 2} r={3} />
            )}
            <text className="neck-number" x={dotX(fret)} y={height - 3} textAnchor="middle">
              {fret}
            </text>
          </g>
        ))}
        {Array.from({ length: frets + 1 }, (_, fret) => (
          <line
            key={fret}
            className={fret === 0 ? 'neck-nut' : 'neck-fret'}
            x1={nut + fret * fretWidth}
            x2={nut + fret * fretWidth}
            y1={neckTop}
            y2={neckBottom}
          />
        ))}
        {track.tuning.map((midi, row) => (
          <g key={row}>
            <line className="neck-string" x1={nut} x2={nut + frets * fretWidth} y1={rowY(row)} y2={rowY(row)} />
            <text className="neck-label" x={LABELS / 2} y={rowY(row) + 4} textAnchor="middle">
              {pitchClassName(midi + capo + pitch)}
            </text>
          </g>
        ))}
        {capo > 0 && capo <= frets && (
          <rect
            className="neck-capo"
            x={dotX(capo) - 3}
            y={neckTop - 5}
            width={6}
            height={neckBottom - neckTop + 10}
            rx={3}
          >
            <title>Capo on fret {capo}</title>
          </rect>
        )}
        {hand !== null && handFrom <= handTo && (
          <rect
            className="neck-hand"
            data-hand={hand}
            data-frets={`${handFrom}-${handTo}`}
            x={nut + (handFrom - 1) * fretWidth}
            y={neckTop - 6}
            width={(handTo - handFrom + 1) * fretWidth}
            height={neckBottom - neckTop + 12}
            rx={4}
          >
            <title>Hand position: index finger at fret {hand}</title>
          </rect>
        )}
        {next.map((dot) => (
          <g key={`next-${dot.row}-${dot.fret}`}>
            <circle className="neck-next" cx={dotX(dot.fret)} cy={rowY(dot.row)} r={radius - 1} />
            {fingerings && radius >= 7 && (
              <text className="neck-next-text" x={dotX(dot.fret)} y={rowY(dot.row) + 3.5} textAnchor="middle">
                {dotLabel(dot)}
              </text>
            )}
          </g>
        ))}
        {now.map((dot) => (
          <g key={`now-${dot.row}-${dot.fret}`}>
            <circle
              className="neck-now"
              data-place={`${dot.row}:${dot.fret}`}
              data-finger={fingerOf(dot)?.finger}
              cx={dotX(dot.fret)}
              cy={rowY(dot.row)}
              r={radius}
            />
            {radius >= 7 && (
              <text className="neck-now-text" x={dotX(dot.fret)} y={rowY(dot.row) + 3.5} textAnchor="middle">
                {dotLabel(dot)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}
