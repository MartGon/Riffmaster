import * as alphaTab from '@coderline/alphatab'

/**
 * Resolves once the player has moved to `tick` and alphaTab has drawn the
 * cursor there, which it does on the frames after the player reports the
 * move. Played next, the cursor then starts from there instead of being
 * drawn while playing, gliding off from the old place. A player still
 * playing is paused first. Gives up waiting after a moment, should no
 * report come.
 */
export async function moveAndDraw(api: alphaTab.AlphaTabApi, tick: number): Promise<void> {
  if (api.playerState === alphaTab.synth.PlayerState.Playing) await paused(api)
  await moved(api, tick)
  // Two frames on, the cursor is in place.
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

/**
 * Pauses and resolves once the player reports it. On that report alphaTab
 * sends the position back to the start of the beat playing; a move sent
 * before it would be undone.
 */
export function paused(api: alphaTab.AlphaTabApi): Promise<void> {
  return waitFor(api.playerStateChanged, (args) => args.state !== alphaTab.synth.PlayerState.Playing, () => api.pause())
}

function moved(api: alphaTab.AlphaTabApi, tick: number): Promise<void> {
  return waitFor(
    api.playerPositionChanged,
    (args) => args.isSeek && Math.abs(args.currentTick - tick) < 5,
    () => {
      api.tickPosition = tick
    },
  )
}

/** Runs `act` and resolves on the first event after it that `matches`, or after half a second. */
function waitFor<T>(emitter: alphaTab.IEventEmitterOfT<T>, matches: (args: T) => boolean, act: () => void): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    // alphaTab hands a new listener the latest event at once; that one is not a report of `act`.
    let listening = false
    const settle = () => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      emitter.off(on)
      resolve()
    }
    const on = (args: T) => {
      if (listening && matches(args)) settle()
    }
    const timer = window.setTimeout(settle, 500)
    emitter.on(on)
    listening = true
    act()
  })
}

/** Start of the bar played at `tick`, or null when no bar is (past the song's end). */
export function barStartAt(lookup: NonNullable<alphaTab.AlphaTabApi['tickCache']>, tick: number): number | null {
  return lookup.masterBars.find((bar) => tick >= bar.start && tick < bar.end)?.start ?? null
}

/**
 * Start of the bar played just before the one at `tick`, for a run-up into a
 * selection; null at the start of the song. Follows repeats, as playback does.
 */
export function leadInStart(lookup: { masterBars: { start: number; end: number }[] }, tick: number): number | null {
  const bars = lookup.masterBars
  const own = bars.findIndex((bar) => tick >= bar.start && tick < bar.end)
  return own > 0 ? bars[own - 1].start : null
}

/** A playback range for alphaTab, from `startTick` up to `endTick`. */
export function playbackRange(range: { startTick: number; endTick: number }): alphaTab.synth.PlaybackRange {
  const made = new alphaTab.synth.PlaybackRange()
  made.startTick = range.startTick
  made.endTick = range.endTick
  return made
}
