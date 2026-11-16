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
