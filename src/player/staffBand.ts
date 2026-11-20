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

type CursorMode = Parameters<alphaTab.ToNextBeatAnimatingCursorHandler['transitionBeatCursor']>[5]
/** alphaTab's cursor mode for moving on to the next beat (named `ToNextBext` there). */
const TO_NEXT_BEAT = 1
/** How long the cursor takes to close a gap to where it should be. */
const CATCH_UP_MS = 150
/** Gaps wider than this are not closed gradually. */
const MAX_CATCH_UP_PX = 40

/**
 * The animated cursor, cut down to the height of the staves. alphaTab moves
 * it with a CSS transition that it replaces at every beat; Safari on the
 * iPhone then shows it at the wrong place for a frame now and then, so the
 * cursor flickers as it reaches each note. Here it is moved frame by frame
 * instead, from where it is to the next beat.
 */
export class StaffCursorHandler extends alphaTab.ToNextBeatAnimatingCursorHandler {
  private frame = 0
  private x = 0

  private halt() {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  private moveTo(cursor: alphaTab.platform.IContainer, x: number) {
    this.x = x
    cursor.transitionToX(0, x)
  }

  onDetach(cursors: Parameters<alphaTab.ToNextBeatAnimatingCursorHandler['onDetach']>[0]) {
    this.halt()
    super.onDetach(cursors)
  }

  placeBeatCursor(cursor: alphaTab.platform.IContainer, beat: alphaTab.rendering.BeatBounds, startBeatX: number) {
    this.halt()
    const band = staffBand(beat.barBounds.masterBarBounds)
    this.x = startBeatX
    cursor.transitionToX(0, startBeatX)
    cursor.setBounds(startBeatX, band.y, 1, band.h)
  }

  placeBarCursor(cursor: alphaTab.platform.IContainer, beat: alphaTab.rendering.BeatBounds) {
    const bar = beat.barBounds.masterBarBounds.visualBounds
    const band = staffBand(beat.barBounds.masterBarBounds)
    cursor.setBounds(bar.x, band.y, bar.w, band.h)
  }

  transitionBeatCursor(
    cursor: alphaTab.platform.IContainer,
    _beat: alphaTab.rendering.BeatBounds,
    startBeatX: number,
    nextBeatX: number,
    duration: number,
    cursorMode: CursorMode,
  ) {
    this.halt()
    if (!(duration > 0)) {
      this.moveTo(cursor, nextBeatX)
      return
    }
    // As alphaTab plans it: at this speed towards the next beat, going on
    // past it (up to twice as far) should the next beat be reported late.
    const reach = cursorMode === TO_NEXT_BEAT ? 2 : 1
    const speed = (nextBeatX - startBeatX) / duration
    // A small gap between where it is and where it should be closes over a
    // moment instead of in one jump; a big one is a jump anyway.
    const gap = Math.abs(this.x - startBeatX) < MAX_CATCH_UP_PX ? this.x - startBeatX : 0
    const begun = performance.now()
    const step = (now: number) => {
      const t = Math.min(duration * reach, Math.max(0, now - begun))
      const x = startBeatX + speed * t + gap * Math.max(0, 1 - t / CATCH_UP_MS)
      this.moveTo(cursor, x)
      this.frame = t < duration * reach ? requestAnimationFrame(step) : 0
    }
    this.frame = requestAnimationFrame(step)
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
