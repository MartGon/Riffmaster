import { describe, expect, it } from 'vitest'
import { listSections, sectionAtBar } from './sections'

const bars = (count: number, marks: Record<number, string>) =>
  Array.from({ length: count }, (_, index) => ({
    index,
    section: index in marks ? { text: marks[index], marker: '' } : null,
  }))

describe('listSections', () => {
  it('runs each section up to the next marker and the last to the end', () => {
    expect(listSections(bars(12, { 0: 'Intro', 4: 'Verse', 8: 'Chorus' }))).toEqual([
      { name: 'Intro', startBar: 0, endBar: 3 },
      { name: 'Verse', startBar: 4, endBar: 7 },
      { name: 'Chorus', startBar: 8, endBar: 11 },
    ])
  })

  it('leaves bars before the first marker out', () => {
    const sections = listSections(bars(6, { 2: 'Verse' }))
    expect(sections).toEqual([{ name: 'Verse', startBar: 2, endBar: 5 }])
    expect(sectionAtBar(sections, 1)).toBe(-1)
    expect(sectionAtBar(sections, 2)).toBe(0)
    expect(sectionAtBar(sections, 5)).toBe(0)
  })

  it('falls back to the marker letter and skips unnamed markers', () => {
    const list = [
      { index: 0, section: { text: ' ', marker: 'A' } },
      { index: 1, section: { text: '', marker: '' } },
      { index: 2, section: null },
    ]
    expect(listSections(list)).toEqual([{ name: 'A', startBar: 0, endBar: 2 }])
  })

  it('returns nothing for a song without markers', () => {
    expect(listSections(bars(4, {}))).toEqual([])
  })

  it('finds the section of a bar', () => {
    const sections = listSections(bars(12, { 0: 'Intro', 4: 'Verse', 8: 'Chorus' }))
    expect([0, 3, 4, 7, 8, 11].map((bar) => sectionAtBar(sections, bar))).toEqual([0, 0, 1, 1, 2, 2])
  })
})
