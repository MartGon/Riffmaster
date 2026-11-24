/** Formats a duration in milliseconds as `m:ss`. */
export function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export const MIN_SPEED = 0.25
export const MAX_SPEED = 2
export const SPEED_STEP = 0.05

/** Clamps a playback speed factor to the supported range, snapped to the step. */
export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1
  const snapped = Math.round(speed / SPEED_STEP) * SPEED_STEP
  const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, snapped))
  return Math.round(clamped * 100) / 100
}

/** The tempo actually heard, in beats per minute, for a base tempo and speed factor. */
export function effectiveTempo(baseTempo: number, speed: number): number {
  return Math.round(baseTempo * speed)
}

/** When a take was played, as in "24 Nov, 14:05". */
export function takeTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
