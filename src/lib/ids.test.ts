import { describe, expect, it } from 'vitest'
import { randomId, sha256, sha256Fallback } from './ids'

describe('hashing without the browser crypto', () => {
  it('matches the built-in SHA-256 for many lengths', async () => {
    for (const size of [0, 1, 55, 56, 63, 64, 65, 1000, 100_003]) {
      const data = new Uint8Array(size).map((_, i) => (i * 31 + size) & 0xff).buffer
      expect(sha256Fallback(data)).toBe(await sha256(data))
    }
    expect(sha256Fallback(new TextEncoder().encode('abc').buffer as ArrayBuffer)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
  it('makes ids shaped like UUIDs', () => {
    expect(randomId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
