import { describe, expect, it } from 'vitest'
import { encodeRecording, RECORDING_RATE } from './recording'
import { decodeWav } from './takeFile'

const samples = (blocks: Float32Array[], rate: number, from: number, to: number) => decodeWav(encodeRecording(blocks, rate, from, to)).samples
const peak = (values: Float32Array) => values.reduce((most, value) => Math.max(most, Math.abs(value)), 0)

describe('recordings', () => {
  it('halves the rate by averaging pairs, and keeps a tone at its pitch', () => {
    // [1, 3, 5, 7] becomes [2, 6], brought up so the loudest is 0.8.
    const pairs = samples([Float32Array.from([0.1, 0.3, 0.5, 0.7])], 48000, 0, 1)
    expect([...pairs].map((x) => Math.round(x * 100))).toEqual([27, 80])
    const tone = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000))
    const down = samples([tone], 48000, 0, 0.1)
    let crossings = 0
    for (let i = 1; i < down.length; i++) if (down[i - 1] < 0 && down[i] >= 0) crossings++
    // 0.1 s of 440 Hz.
    expect(crossings).toBeGreaterThanOrEqual(43)
    expect(crossings).toBeLessThanOrEqual(45)
  })

  it('brings the level up, but not endlessly', () => {
    expect(peak(samples([new Float32Array(480).fill(0.1)], 24000, 0, 1))).toBeCloseTo(0.8, 3)
    expect(peak(samples([new Float32Array(480).fill(0.001)], 24000, 0, 1))).toBeCloseTo(0.02, 3)
    expect(peak(samples([new Float32Array(480)], 24000, 0, 1))).toBe(0)
  })

  it('reads across blocks as one stretch would', () => {
    const tone = Float32Array.from({ length: 9600 }, (_, i) => Math.sin(i / 7) * 0.3)
    const split = [tone.subarray(0, 1000), tone.subarray(1000, 1003), tone.subarray(1003)]
    expect([...samples(split, 48000, 0.01, 0.15)]).toEqual([...samples([tone], 48000, 0.01, 0.15)])
    // It starts at the cut, not at the start of the audio.
    const ramp = Float32Array.from({ length: 4800 }, (_, i) => i / 4800)
    const cut = samples([ramp], 48000, 0.05, 0.1)
    expect(cut.length).toBe(1200)
    expect(cut[0]).toBeCloseTo((0.8 * (2400.5 / 4800)) / (4799 / 4800), 2)
  })

  it('makes a small WAV of the stretch', () => {
    const decoded = decodeWav(encodeRecording([new Float32Array(48000).fill(0.5)], 48000, 0.25, 0.75))
    expect(decoded.sampleRate).toBe(RECORDING_RATE)
    expect(decoded.samples.length).toBe(RECORDING_RATE / 2)
  })
})
