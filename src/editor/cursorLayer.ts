import type * as alphaTab from '@coderline/alphatab'
import type { Cursor } from './history'

export interface CursorBox {
  /** Centre of the string at the cursor's beat, in the score's coordinates. */
  x: number
  y: number
  /** Top and height of the tab staff the beat is on. */
  staffTop: number
  staffHeight: number
  /** Distance between two strings. */
  lineGap: number
}

/**
 * Where the cursor is drawn. The tab staff's lines run from the top of its
 * bar box (highest string) to the bottom (lowest string), so any string can
 * be found even where it has no note.
 */
export function cursorBox(api: alphaTab.AlphaTabApi, cursor: Cursor): CursorBox | null {
  const lookup = api.boundsLookup
  const staff = api.score?.tracks[cursor.track]?.staves[0]
  const beat = staff?.bars[cursor.bar]?.voices[0]?.beats[cursor.beat]
  if (!lookup || !staff || !beat) return null
  const strings = staff.tuning.length
  // With standard notation shown, a beat is drawn on two staves; the tab is the lower one.
  const places = lookup.findBeats(beat)
  const place = places?.[places.length - 1]
  let barBounds = place?.barBounds
  let x = place?.onNotesX
  if (!barBounds) {
    const masterBar = lookup.findMasterBarByIndex(cursor.bar)
    barBounds = masterBar?.bars[masterBar.bars.length - 1]
    if (!barBounds) return null
    x = barBounds.visualBounds.x + 16
  }
  const box = barBounds.visualBounds
  const lineGap = strings > 1 ? box.h / (strings - 1) : 12
  return {
    x: x ?? box.x,
    y: box.y + (strings - cursor.string) * lineGap,
    staffTop: box.y,
    staffHeight: box.h,
    lineGap,
  }
}

/**
 * Where a click lands relative to a beat's tab staff: the nearest string, or
 * 'above' for the notation staff over it, or 'below' for whatever is under
 * it (another staff of the track, or the next system).
 */
export function stringAtY(
  api: alphaTab.AlphaTabApi,
  beat: alphaTab.model.Beat,
  y: number,
): number | 'above' | 'below' | null {
  const places = api.boundsLookup?.findBeats(beat)
  const box = places?.[places.length - 1]?.barBounds.visualBounds
  const strings = beat.voice.bar.staff.tuning.length
  if (!box || strings < 2) return null
  const gap = box.h / (strings - 1)
  const fromTop = Math.round((y - box.y) / gap)
  if (fromTop < -1) return 'above'
  if (fromTop > strings) return 'below'
  return strings - Math.min(strings - 1, Math.max(0, fromTop))
}

/** Draws the edit cursor in a layer over the score. */
export class CursorLayer {
  private readonly element: HTMLElement
  private readonly column: HTMLDivElement
  private readonly box: HTMLDivElement

  constructor(element: HTMLElement) {
    this.element = element
    this.column = document.createElement('div')
    this.column.className = 'edit-beat'
    this.box = document.createElement('div')
    this.box.className = 'edit-cursor'
    element.replaceChildren(this.column, this.box)
  }

  /** Shows the cursor, scrolling it into view when asked. Returns false if it could not be placed. */
  show(api: alphaTab.AlphaTabApi, cursor: Cursor, scroll: boolean): boolean {
    const place = cursorBox(api, cursor)
    this.element.hidden = !place
    if (!place) return false
    const size = Math.max(16, place.lineGap + 3)
    Object.assign(this.box.style, {
      left: `${place.x - size / 2}px`,
      top: `${place.y - size / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
    })
    Object.assign(this.column.style, {
      left: `${place.x - size / 2 - 2}px`,
      top: `${place.staffTop - size / 2 - 2}px`,
      width: `${size + 4}px`,
      height: `${place.staffHeight + size + 4}px`,
    })
    if (scroll) this.column.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    return true
  }

  hide(): void {
    this.element.hidden = true
  }
}
