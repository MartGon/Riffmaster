/** A named part of the song, such as "Verse 1", as marked in the tab file. */
export interface SongSection {
  name: string
  /** First and last bar of the section, counted from 0. */
  startBar: number
  endBar: number
}

interface BarLike {
  index: number
  section: { text: string; marker: string } | null
}

/**
 * Lists the sections marked in a song. Each one runs up to the bar before
 * the next marker, and the last one to the end of the song. Bars before the
 * first marker belong to no section.
 */
export function listSections(bars: BarLike[]): SongSection[] {
  const sections: SongSection[] = []
  for (const bar of bars) {
    if (!bar.section) continue
    const name = bar.section.text.trim() || bar.section.marker.trim()
    if (!name) continue
    const previous = sections[sections.length - 1]
    if (previous) previous.endBar = bar.index - 1
    sections.push({ name, startBar: bar.index, endBar: bar.index })
  }
  const last = sections[sections.length - 1]
  if (last && bars.length > 0) last.endBar = bars[bars.length - 1].index
  return sections
}

/** Index of the section a bar belongs to, or -1 when it is before the first one. */
export function sectionAtBar(sections: SongSection[], bar: number): number {
  for (let i = sections.length - 1; i >= 0; i--) {
    if (bar >= sections[i].startBar) return bar <= sections[i].endBar ? i : -1
  }
  return -1
}
