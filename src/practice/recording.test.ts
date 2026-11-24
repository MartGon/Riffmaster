import { describe, expect, it } from 'vitest'
import { clipSamples, encodeRecording, normalize, RECORDING_RATE, resample } from './recording'
import { decodeWav } from './takeFile'

const blocks = [Float32Array.from([0, 1, 2]), Float32Array.from([3, 4]), Float32Array.from([5, 6, 7])]

describe('recordings', () => {
  it('cuts a stretch across blocks', () => {
    expect([...clipSamples(blocks, 2, 6)]).toEqual([2, 3, 4, 5])
    expect([...clipSamples(blocks, -3, 2)]).toEqual([0, 1])
    expect([...clipSamples(blocks, 6, 99)]).toEqual([6, 7])
    expect(clipSamples(blocks, 9, 12).length).toBe(0)
  })

  it('halves the rate by averaging pairs, and keeps a tone at its pitch', () => {
    expect([...resample(Float32Array.from([1, 3, 5, 7]), 48000, 24000)]).toEqual([2, 6])
    const tone = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000))
    const down = resample(tone, 48000, 24000)
    let crossings = 0
    for (let i = 1; i < down.length; i++) if (down[i - 1] < 0 && down[i] >= 0) crossings++
    // 0.1 s of 440 Hz.
    expect(crossings).toBeGreaterThanOrEqual(43)
    expect(crossings).toBeLessThanOrEqual(45)
  })

  it('brings the level up, but not endlessly', () => {
    expect(Math.max(...normalize(Float32Array.from([0.1, -0.2])))).toBeCloseTo(0.4)
    expect(Math.min(...normalize(Float32Array.from([0.1, -0.2])))).toBeCloseTo(-0.8)
    expect(Math.max(...normalize(Float32Array.from([0.001])))).toBeCloseTo(0.02)
    expect([...normalize(new Float32Array(3))]).toEqual([0, 0, 0])
  })

  it('reads across blocks as one stretch would', () => {
    const tone = Float32Array.from({ length: 9600 }, (_, i) => Math.sin(i / 7) * 0.3)
    const split = [tone.subarray(0, 1000), tone.subarray(1000, 1003), tone.subarray(1003)]
    const whole = decodeWav(encodeRecording([tone], 48000, 0.01, 0.15)).samples
    const parts = decodeWav(encodeRecording(split, 48000, 0.01, 0.15)).samples
    expect([...parts]).toEqual([...whole])
    expect([...whole.slice(0, 3)].map((x) => Math.round(x * 1000))).toEqual(
      [...normalize(resample(clipSamples([tone], 480, 7200), 48000, 24000)).slice(0, 3)].map((x) => Math.round(x * 1000)),
    )
  })

  it('makes a small WAV of the stretch', () => {
    const second = [new Float32Array(48000).fill(0.5)]
    const wav = encodeRecording(second, 48000, 0.25, 0.75)
    const decoded = decodeWav(wav)
    expect(decoded.sampleRate).toBe(RECORDING_RATE)
    expect(decoded.samples.length).toBe(RECORDING_RATE / 2)
  })
})
