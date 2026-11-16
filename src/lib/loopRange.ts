/** The parts of an alphaTab beat needed to find the bar it belongs to. */
export interface BeatLike {
  absolutePlaybackStart: number
  voice: { bar: { voices: { beats: BeatLike[] }[] } }
}

/**
 * Widens a beat selection to whole bars: from the first beat of the earlier
 * beat's bar to the last beat of the later beat's bar. The two beats may be
 * given in either order.
 */
export function snapSelectionToBars<B extends BeatLike>(a: B, b: B): { start: B; end: B } {
  const [first, last] = a.absolutePlaybackStart <= b.absolutePlaybackStart ? [a, b] : [b, a]
  const firstBarBeats = first.voice.bar.voices[0]?.beats ?? []
  const lastBarBeats = last.voice.bar.voices[0]?.beats ?? []
  return {
    start: (firstBarBeats[0] as B | undefined) ?? first,
    end: (lastBarBeats[lastBarBeats.length - 1] as B | undefined) ?? last,
  }
}
