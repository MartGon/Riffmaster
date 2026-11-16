/** Size of the analysis window in samples; must be a power of two. */
export const FFT_SIZE = 4096

const cosTable = new Float64Array(FFT_SIZE / 2)
const sinTable = new Float64Array(FFT_SIZE / 2)
for (let i = 0; i < FFT_SIZE / 2; i++) {
  cosTable[i] = Math.cos((2 * Math.PI * i) / FFT_SIZE)
  sinTable[i] = Math.sin((2 * Math.PI * i) / FFT_SIZE)
}
const reversed = new Uint16Array(FFT_SIZE)
for (let i = 0, bits = Math.log2(FFT_SIZE); i < FFT_SIZE; i++) {
  let r = 0
  for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
  reversed[i] = r
}

/**
 * Magnitude spectrum of up to FFT_SIZE samples. Shorter input is tapered
 * over its own length and padded with silence, and the result is scaled so
 * that spectra of different lengths can be compared.
 */
export function magnitudeSpectrum(samples: Float32Array): Float64Array {
  const length = Math.min(samples.length, FFT_SIZE)
  const re = new Float64Array(FFT_SIZE)
  const im = new Float64Array(FFT_SIZE)
  for (let i = 0; i < length; i++) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, length - 1))
    re[reversed[i]] = samples[i] * hann
  }
  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const half = size >> 1
    const step = FFT_SIZE / size
    for (let start = 0; start < FFT_SIZE; start += size) {
      for (let j = 0, t = 0; j < half; j++, t += step) {
        const a = start + j
        const b = a + half
        const xr = re[b] * cosTable[t] + im[b] * sinTable[t]
        const xi = im[b] * cosTable[t] - re[b] * sinTable[t]
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
  const out = new Float64Array(FFT_SIZE / 2)
  const scale = 2 / Math.max(1, length)
  for (let i = 0; i < out.length; i++) out[i] = Math.hypot(re[i], im[i]) * scale
  return out
}

const LOWEST_MIDI = 28 // E1, the low string of a bass
const HIGHEST_MIDI = 96

/**
 * Finds which notes a spectrum most plausibly contains by adding up the
 * energy at each candidate note's harmonics. Returns MIDI pitches, the most
 * likely first; the second is included only when it is nearly as strong,
 * which happens when the octave is ambiguous.
 */
export function likelyPitches(spectrum: Float64Array, sampleRate: number): number[] {
  const binHz = sampleRate / FFT_SIZE
  let total = 0
  for (let i = 0; i < spectrum.length; i++) total += spectrum[i]
  if (total <= 0) return []

  const scores: { midi: number; score: number }[] = []
  for (let midi = LOWEST_MIDI; midi <= HIGHEST_MIDI; midi++) {
    const f0 = 440 * 2 ** ((midi - 69) / 12)
    let score = 0
    let present = 0
    let harmonics = 0
    for (let h = 1; h <= 10; h++) {
      const hz = f0 * h
      if (hz > 5000 || hz > sampleRate / 2 - binHz) break
      // Allow about a fifth of a semitone of mistuning. For low harmonics
      // that is less than one bin, so the spectrum is read at the exact
      // frequency instead; searching neighbouring bins there would pick up
      // the harmonics of other low notes.
      const position = hz / binHz
      const reach = Math.round((hz * 0.012) / binHz)
      let peak = 0
      if (reach === 0) {
        const low = Math.floor(position)
        const mix = position - low
        peak = (spectrum[low] ?? 0) * (1 - mix) + (spectrum[low + 1] ?? 0) * mix
      } else {
        const centre = Math.round(position)
        for (let k = centre - reach; k <= centre + reach; k++) {
          if (k > 0 && k < spectrum.length && spectrum[k] > peak) peak = spectrum[k]
        }
      }
      harmonics++
      score += peak / Math.sqrt(h)
      if (h <= 4 && peak > 0) present++
    }
    // A real note shows several of its first harmonics, not just one.
    if (harmonics > 0 && present >= Math.min(2, harmonics)) scores.push({ midi, score })
  }
  scores.sort((a, b) => b.score - a.score)
  if (scores.length === 0) return []
  const best = scores[0]
  const result = [best.midi]
  const second = scores.find((s) => s !== best && Math.abs(s.midi - best.midi) > 1)
  if (second && second.score >= best.score * 0.8) result.push(second.midi)
  return result
}

/**
 * Compression: partials count by their ratio, not their size, down to this
 * far below the strongest partial around (as a factor). Measuring against
 * the strongest partial makes the result the same for a quiet and a loud
 * input.
 */
const FLUX_DEPTH = 30
/** A partial weaker than this is treated as silence. */
const FLUX_QUIETEST = 1e-3
/**
 * Windows the meter looks ahead before it answers. The strongest partial is
 * taken from the note that is starting as well as from what came before;
 * otherwise the faint touch of the pick on the string, just before a note
 * played out of silence, would count for more than the note.
 */
export const FLUX_AHEAD = 3
/** How fast the memory of the strongest partial fades, per window. */
const FLUX_FADE = 0.995

/**
 * Measures how much new sound each short window adds: the growth of every
 * partial over the same partial a moment earlier, summed over the range of
 * a guitar ("spectral flux"). A picked note adds partials of its own, so it
 * stands out even while louder strings ring on, where the overall level and
 * brightness hardly move. A partial that only drifts to the neighbouring
 * frequency, as in vibrato, is not counted as new.
 *
 * A long window tells low notes apart and so misses fewer attacks; a short
 * one says more exactly when an attack happened.
 */
export class FluxMeter {
  /** Window length in samples. */
  readonly size: number
  private readonly lag: number
  private readonly low: number
  private readonly high: number
  private readonly history: { partials: Float64Array; loudest: number }[] = []
  /** The strongest partial of the windows already answered for, fading with time. */
  private remembered = 0
  private readonly re: Float64Array
  private readonly im: Float64Array
  private readonly hann: Float64Array
  private readonly cos: Float64Array
  private readonly sin: Float64Array
  private readonly reversed: Uint16Array

  /**
   * `size` must be a power of two; `lag` is how many windows back the
   * comparison reaches.
   */
  constructor(sampleRate: number, size: number, lag: number) {
    this.size = size
    this.lag = lag
    const binHz = sampleRate / size
    this.low = Math.max(1, Math.ceil(70 / binHz))
    this.high = Math.min(size / 2 - 2, Math.floor(6000 / binHz))
    this.re = new Float64Array(size)
    this.im = new Float64Array(size)
    this.hann = new Float64Array(size)
    this.cos = new Float64Array(size / 2)
    this.sin = new Float64Array(size / 2)
    this.reversed = new Uint16Array(size)
    for (let i = 0; i < size; i++) this.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1))
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size)
      this.sin[i] = Math.sin((2 * Math.PI * i) / size)
    }
    for (let i = 0, bits = Math.log2(size); i < size; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
      this.reversed[i] = r
    }
  }

  /**
   * Takes the next window of `size` samples and returns the flux of the
   * window given FLUX_AHEAD calls earlier (0 until there is one).
   */
  next(window: Float32Array): number {
    const { re, im, low, high, size, cos, sin, reversed, hann } = this
    im.fill(0)
    for (let i = 0; i < size; i++) re[reversed[i]] = window[i] * hann[i]
    for (let span = 2; span <= size; span <<= 1) {
      const half = span >> 1
      const step = size / span
      for (let start = 0; start < size; start += span) {
        for (let j = 0, t = 0; j < half; j++, t += step) {
          const a = start + j
          const b = a + half
          const xr = re[b] * cos[t] + im[b] * sin[t]
          const xi = im[b] * cos[t] - re[b] * sin[t]
          re[b] = re[a] - xr
          im[b] = im[a] - xi
          re[a] += xr
          im[a] += xi
        }
      }
    }
    const partials = new Float64Array(high + 2)
    let loudest = 0
    for (let k = low - 1; k <= high + 1; k++) {
      partials[k] = (Math.hypot(re[k], im[k]) * 2) / size
      if (partials[k] > loudest) loudest = partials[k]
    }
    const { history, lag } = this
    history.push({ partials, loudest })
    // Oldest first: the window to compare with, then `lag` later the one
    // being answered for, then the ones ahead of it.
    if (history.length <= lag + FLUX_AHEAD) return 0
    const before = history[0].partials
    const now = history[lag].partials
    let reference = Math.max(FLUX_QUIETEST, this.remembered)
    for (const window of history) if (window.loudest > reference) reference = window.loudest
    const gain = FLUX_DEPTH / reference
    let flux = 0
    for (let k = low; k <= high; k++) {
      const was = Math.max(before[k - 1], before[k], before[k + 1])
      if (now[k] > was) flux += Math.log((1 + gain * now[k]) / (1 + gain * was))
    }
    this.remembered = Math.max(this.remembered * FLUX_FADE, history[0].loudest)
    history.shift()
    return flux
  }
}
