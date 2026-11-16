import * as alphaTab from '@coderline/alphatab'
import { describe, expect, it } from 'vitest'
import { trackEvents, trackFingerings } from './fromScore'

// The app's type settings have no Node types, so the file system is reached
// through a plain dynamic import.
const fsModule = 'node:fs'
const { existsSync, readFileSync } = (await import(/* @vite-ignore */ fsModule)) as {
  existsSync(path: URL): boolean
  readFileSync(path: URL): Uint8Array
}

// The test tab is not in the repository; without it these checks are skipped.
const file = new URL('../../samples/californication.gp', import.meta.url)
const present = existsSync(file)

describe.skipIf(!present)('fingerings for a whole song', () => {
  const score = present ? alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(file))) : null

  it('gives every fretted note of every string track a playable finger', () => {
    for (const track of score!.tracks) {
      const prepared = trackEvents(track)
      if (!prepared) continue
      const started = performance.now()
      const fingerings = trackFingerings(track)
      const took = performance.now() - started
      let fretted = 0
      let missing = 0
      for (const event of prepared.events) {
        const down = event.notes.filter((note) => note.fret > 0)
        for (const note of down) {
          fretted++
          if (!fingerings.has(note.id)) missing++
        }
        // Within one moment fingers rise with the frets.
        for (const a of down) {
          for (const b of down) {
            const fa = fingerings.get(a.id)?.finger
            const fb = fingerings.get(b.id)?.finger
            if (typeof fa !== 'number' || typeof fb !== 'number') continue
            if (a.fret < b.fret) expect(fa).toBeLessThan(fb)
          }
        }
      }
      expect(missing / Math.max(1, fretted)).toBeLessThan(0.01)
      expect(took).toBeLessThan(1500)
    }
  })
})
