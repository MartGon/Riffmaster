import * as alphaTab from '@coderline/alphatab'

/** Room left above and below the staff lines, in pixels of the drawn score. */
const PAD = 6

/** Top and height of a stretch of the score, in the score's own pixels. */
export interface Band {
  y: number
  h: number
}

const bands = new WeakMap<alphaTab.rendering.StaffSystemBounds, Band>()

/**
 * The height taken by the staves of a line of music: their staff lines and
 * every note head on or off them, without the tempo, section names, text and
 * dynamics alphaTab draws above and below, which its own bounds include.
 * Worked out once per line; a new rendering makes new bounds.
 */
export function systemStaffBand(system: alphaTab.rendering.StaffSystemBounds): Band {
  const known = bands.get(system)
  if (known) return known
  let top = Infinity
  let bottom = -Infinity
  const take = (box: Band) => {
    top = Math.min(top, box.y)
    bottom = Math.max(bottom, box.y + box.h)
  }
  for (const bar of system.bars) {
    for (const staff of bar.bars) {
      take(staff.visualBounds)
      for (const beat of staff.beats) for (const note of beat.notes ?? []) take(note.noteHeadBounds)
    }
  }
  const band = Number.isFinite(top) ? { y: top - PAD, h: bottom - top + 2 * PAD } : system.visualBounds
  bands.set(system, band)
  return band
}

function staffBand(bar: alphaTab.rendering.MasterBarBounds): Band {
  return bar.staffSystemBounds ? systemStaffBand(bar.staffSystemBounds) : bar.visualBounds
}

/** The default animated cursor, cut down to the height of the staves. */
export class StaffCursorHandler extends alphaTab.ToNextBeatAnimatingCursorHandler {
  placeBeatCursor(cursor: alphaTab.platform.IContainer, beat: alphaTab.rendering.BeatBounds, startBeatX: number) {
    const band = staffBand(beat.barBounds.masterBarBounds)
    cursor.transitionToX(0, startBeatX)
    cursor.setBounds(startBeatX, band.y, 1, band.h)
  }

  placeBarCursor(cursor: alphaTab.platform.IContainer, beat: alphaTab.rendering.BeatBounds) {
    const bar = beat.barBounds.masterBarBounds.visualBounds
    const band = staffBand(beat.barBounds.masterBarBounds)
    cursor.setBounds(bar.x, band.y, bar.w, band.h)
  }
}

const TRANSFORM = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\((-?[\d.e+-]+), (-?[\d.e+-]+)\)/

/**
 * alphaTab draws a selection as tall as the whole line of music. This cuts
 * each block down to the staves of its line. Blocks are scaled divs, so
 * their position and height live in a transform.
 */
export function trimSelection(
  api: alphaTab.AlphaTabApi,
  scoreElement: HTMLElement,
  blocks: alphaTab.PlaybackHighlightChangeEventArgs['highlightBlocks'],
): void {
  const systems = api.boundsLookup?.staffSystems
  if (!blocks?.length || !systems) return
  const drawn = scoreElement.querySelectorAll<HTMLElement>('.at-selection > div')
  if (drawn.length !== blocks.length) return
  blocks.forEach((block, index) => {
    const system = systems.find(
      (line) => block.y >= line.visualBounds.y - 0.5 && block.y < line.visualBounds.y + line.visualBounds.h,
    )
    const band = system ? systemStaffBand(system) : null
    const element = drawn[index]
    const match = TRANSFORM.exec(element.style.transform)
    if (!band || !match || block.h <= 0) return
    const [, x, , scaleX, scaleY] = match
    const newScaleY = (Number(scaleY) * band.h) / block.h
    element.style.transform = element.style.transform.replace(
      TRANSFORM,
      `translate(${x}px, ${band.y}px) scale(${scaleX}, ${newScaleY})`,
    )
  })
}
