/** Playback choices remembered for each song. */
export interface SongSettings {
  /** Playback speed factor, 1 being the written tempo. */
  speed: number
  /** Index of the track shown, or null to let the player choose. */
  trackIndex: number | null
  mutedTracks: number[]
  soloTracks: number[]
  /** Volume of each track as a factor, 1 being as written; tracks at 1 are left out. Missing in older records. */
  volumes?: Record<number, number>
  /**
   * Semitones every pitched track is shifted by when played and practised, so
   * the song can be played on a guitar tuned differently from the tab. The
   * tab itself is unchanged. Missing in older records, meaning 0.
   */
  pitch?: number
}

export const defaultSongSettings: SongSettings = {
  speed: 1,
  trackIndex: null,
  mutedTracks: [],
  soloTracks: [],
  volumes: {},
}

/**
 * A song in the library. `updatedAt` and `deletedAt` exist so that two
 * devices can later merge their libraries: the newest change wins, and a
 * deletion is kept as a marker instead of removing the record.
 */
export interface Song {
  id: string
  title: string
  artist: string
  fileName: string
  /** File size in bytes. */
  size: number
  /** SHA-256 of the file, used to recognise a file that is already in the library. */
  hash: string
  addedAt: number
  updatedAt: number
  lastOpenedAt: number
  deletedAt: number | null
  settings: SongSettings
  /**
   * Set on a deleted song that was the same file as another song added on
   * another device: the id of the song kept instead. Its practice takes move there.
   */
  mergedInto?: string
}

/** How one bar went in a practice take. */
export interface BarTally {
  /** Single notes of the bar that were scored. */
  scored: number
  missed: number
  /** Notes that were played, but early or late. */
  offTime: number
}

/**
 * One finished practice take, kept so progress can be followed over time.
 * Takes are only ever added or removed whole, which keeps merging two
 * devices' histories simple.
 */
export interface TakeRecord {
  id: string
  songId: string
  /** When the take ended, in ms since the epoch. */
  at: number
  trackIndex: number
  /** Playback speed factor the take was played at. */
  speed: number
  /** First and last bar the take covered, counted from 0. */
  startBar: number
  endBar: number
  scored: number
  onTime: number
  early: number
  late: number
  missed: number
  /** Share of scored notes that were played, from 0 to 1. */
  accuracy: number
  /** Results per bar, keyed by bar index; bars without scored notes are left out. */
  bars: Record<number, BarTally>
  /** Whether the take was a round of the speed trainer. */
  trainer: boolean
}
