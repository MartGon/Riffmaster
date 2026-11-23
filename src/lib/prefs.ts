/** Choices that belong to this device rather than to a song. */
export interface Prefs {
  metronome: boolean
  countIn: boolean
  showNotation: boolean
  showFretboard: boolean
  /** Finger numbers beside the notes of the tab and on the fretboard. */
  showFingering: boolean
  /** Overall volume as a factor, 1 being full. */
  masterVolume: number
  /** Playing selected bars starts one bar before them. */
  leadIn: boolean
}

const KEY = 'riffmaster.prefs'

/** Loudest a volume slider goes, as a factor: 1.5 is 150%. */
export const MAX_VOLUME = 1.5
const defaults: Prefs = {
  metronome: false,
  countIn: false,
  showNotation: false,
  showFretboard: false,
  showFingering: false,
  masterVolume: 1,
  leadIn: false,
}

export function loadPrefs(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    return {
      metronome: stored.metronome === true,
      countIn: stored.countIn === true,
      showNotation: stored.showNotation === true,
      showFretboard: stored.showFretboard === true,
      showFingering: stored.showFingering === true,
      masterVolume:
        typeof stored.masterVolume === 'number' && stored.masterVolume >= 0 && stored.masterVolume <= MAX_VOLUME
          ? stored.masterVolume
          : 1,
      leadIn: stored.leadIn === true,
    }
  } catch {
    return { ...defaults }
  }
}

export function savePrefs(change: Partial<Prefs>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...change }))
  } catch {
    // Storage can be unavailable (private browsing); the choice then lasts for this visit only.
  }
}
