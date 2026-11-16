import { describe, expect, it } from 'vitest'
import { decodeTake, decodeWav, encodeTake, encodeWav } from './takeFile'

function text(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/** The 16-bit samples after the 44-byte header. */
function int16s(bytes: Uint8Array): number[] {
  const data = view(bytes)
  return Array.from({ length: (bytes.length - 44) / 2 }, (_, i) => data.getInt16(44 + i * 2, true))
}

describe('encodeWav', () => {
  it('writes a mono 16-bit PCM header', () => {
    const bytes = encodeWav([new Float32Array([0, 0.5, -0.5])], 48000)
    const data = view(bytes)
    expect(text(bytes, 0, 4)).toBe('RIFF')
    expect(data.getUint32(4, true)).toBe(bytes.length - 8)
    expect(text(bytes, 8, 4)).toBe('WAVE')
    expect(text(bytes, 12, 4)).toBe('fmt ')
    expect(data.getUint32(16, true)).toBe(16)
    expect(data.getUint16(20, true)).toBe(1)
    expect(data.getUint16(22, true)).toBe(1)
    expect(data.getUint32(24, true)).toBe(48000)
    expect(data.getUint32(28, true)).toBe(96000)
    expect(data.getUint16(32, true)).toBe(2)
    expect(data.getUint16(34, true)).toBe(16)
    expect(text(bytes, 36, 4)).toBe('data')
    expect(data.getUint32(40, true)).toBe(6)
  })

  it('gives a 44-byte file for no samples', () => {
    const bytes = encodeWav([], 44100)
    expect(bytes.length).toBe(44)
    expect(view(bytes).getUint32(40, true)).toBe(0)
    expect(view(bytes).getUint32(4, true)).toBe(36)
  })

  it('concatenates blocks in order', () => {
    const bytes = encodeWav([new Float32Array([0.25, 0.5]), new Float32Array([]), new Float32Array([-0.25])], 8000)
    expect(bytes.length).toBe(44 + 2 * 3)
    expect(int16s(bytes)).toEqual([Math.round(0.25 * 32767), Math.round(0.5 * 32767), -8192])
  })

  it('maps 1 to 32767 and -1 to -32768', () => {
    expect(int16s(encodeWav([new Float32Array([1, -1, 0])], 8000))).toEqual([32767, -32768, 0])
  })

  it('clamps values beyond ±1 and turns NaN into 0', () => {
    const bytes = encodeWav([new Float32Array([2, -3, NaN, Infinity, -Infinity])], 8000)
    expect(int16s(bytes)).toEqual([32767, -32768, 0, 32767, -32768])
  })
})

describe('decodeWav', () => {
  it('reads back what encodeWav wrote', () => {
    const input = Float32Array.from({ length: 500 }, (_, i) => Math.sin(i / 7) * 0.9)
    const { sampleRate, samples } = decodeWav(encodeWav([input.subarray(0, 200), input.subarray(200)], 22050))
    expect(sampleRate).toBe(22050)
    expect(samples.length).toBe(input.length)
    for (let i = 0; i < input.length; i++) {
      expect(Math.abs(samples[i] - input[i])).toBeLessThanOrEqual(1 / 32767)
    }
  })

  it('reads an empty file', () => {
    const { sampleRate, samples } = decodeWav(encodeWav([], 16000))
    expect(sampleRate).toBe(16000)
    expect(samples.length).toBe(0)
  })

  it('throws on garbage', () => {
    expect(() => decodeWav(new Uint8Array([1, 2, 3]))).toThrow(Error)
    expect(() => decodeWav(new TextEncoder().encode('this is not a wav file at all, not even close'))).toThrow(
      /WAV/,
    )
  })

  it('throws on a WAV that is not 16-bit PCM', () => {
    const bytes = encodeWav([new Float32Array([0.1])], 8000)
    view(bytes).setUint16(20, 3, true)
    expect(() => decodeWav(bytes)).toThrow(/16-bit PCM/)
  })
})

describe('encodeTake', () => {
  it('carries the report with the audio and still reads as a WAV file', () => {
    const blocks = [new Float32Array([0, 0.5, -0.5])]
    for (const report of [{ note: 'é', list: [1, 2] }, { odd: 'x' }]) {
      const bytes = encodeTake(blocks, 48000, report)
      expect(bytes.length % 2).toBe(0)
      expect(new DataView(bytes.buffer).getUint32(4, true)).toBe(bytes.length - 8)
      expect(decodeWav(bytes).samples.length).toBe(3)
      const take = decodeTake(bytes)
      expect(take.sampleRate).toBe(48000)
      expect(take.report).toEqual(report)
    }
  })

  it('gives no report for a plain WAV file', () => {
    expect(decodeTake(encodeWav([new Float32Array(4)], 44100)).report).toBeNull()
  })
})
