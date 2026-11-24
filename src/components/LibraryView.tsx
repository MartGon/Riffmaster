import type { ReactNode } from 'react'
import type { SongProgress } from '../practice/progress'
import type { Song } from '../library/types'
import { versionText } from '../lib/version'
import { Icon } from './Icon'

interface Props {
  /** Null while the list is being read from storage. */
  songs: Song[] | null
  /** How far along each practised song is, keyed by song id. */
  progress: Map<string, SongProgress>
  /** Days in a row with practice, and minutes practised in the last seven days. */
  streak: number
  weekMinutes: number
  busy: boolean
  onOpen: (song: Song) => void
  onDelete: (song: Song) => void
  onAdd: () => void
  /** Starts a blank tab. */
  onNew: () => void
  /** Shows the built-in exercises. */
  onExercises: () => void
  onFindNote: () => void
  /** Today's practice plan, shown above the list. */
  plan: ReactNode
}

function formatOpened(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function practiceText(progress: SongProgress | undefined): string {
  if (!progress) return ''
  const takes = progress.takes === 1 ? '1 take' : `${progress.takes} takes`
  return `${takes}, ${Math.round(progress.mastery * 100)}% learned`
}

/** The practice streak and this week's minutes, when there is something to say. */
function practiceLine(streak: number, minutes: number): string {
  const parts: string[] = []
  if (streak > 0) parts.push(streak === 1 ? 'Practised today or yesterday' : `${streak}-day practice streak`)
  if (minutes > 0) parts.push(`${minutes} min this week`)
  return parts.join(' · ')
}

/** A song's mastery as a thin bar under its name. */
function Mastery({ progress }: { progress: SongProgress }) {
  const percent = Math.round(progress.mastery * 100)
  return (
    <span
      className="mastery"
      // The row already says how much is learned.
      aria-hidden="true"
      title={`${percent}% learned: ${progress.mastered} of ${progress.total} bars clean at full tempo, ${progress.learning} still coming along`}
    >
      <span style={{ width: `${percent}%` }} />
    </span>
  )
}

export function LibraryView({ songs, progress, streak, weekMinutes, busy, onOpen, onDelete, onAdd, onNew, onExercises, onFindNote, plan }: Props) {
  const practised = practiceLine(streak, weekMinutes)
  if (songs === null) return <div className="library" />

  if (songs.length === 0) {
    return (
      <div className="library library-empty">
        <h1>Add a tab to start playing</h1>
        <p>Drop files here, or pick them from your device. They are saved in this browser.</p>
        <div className="library-buttons">
          <button type="button" className="button primary" disabled={busy} onClick={onAdd}>
            <Icon name="plus" />
            Add files
          </button>
          <button type="button" className="button" disabled={busy} onClick={onNew}>
            <Icon name="edit" />
            New tab
          </button>
          <button type="button" className="button" disabled={busy} onClick={onExercises}>
            <Icon name="exercise" />
            Exercises
          </button>
          <button type="button" className="button" disabled={busy} onClick={onFindNote}>
            <Icon name="exercise" />
            Find the note
          </button>
        </div>
        <p className="hint">Guitar Pro 3 to 8 (.gp, .gpx, .gp5, .gp4, .gp3) and MusicXML</p>
        <p className="app-version">{versionText()}</p>
      </div>
    )
  }

  return (
    <div className="library">
      <div className="library-head">
        <h1>
          Library
          <span className="library-count">
            {songs.length === 1 ? '1 tab' : `${songs.length} tabs`}
          </span>
        </h1>
        <div className="library-buttons">
          <button type="button" className="button" disabled={busy} onClick={onExercises}>
            <Icon name="exercise" />
            Exercises
          </button>
          <button type="button" className="button" disabled={busy} onClick={onFindNote}>
            <Icon name="exercise" />
            Find the note
          </button>
          <button type="button" className="button" disabled={busy} onClick={onNew}>
            <Icon name="edit" />
            New tab
          </button>
          <button type="button" className="button primary" disabled={busy} onClick={onAdd}>
            <Icon name="plus" />
            Add files
          </button>
        </div>
      </div>
      {practised && <p className="library-streak">{practised}</p>}
      {plan}
      <ul className="songs">
        {songs.map((song) => (
          <li key={song.id} className="song-row">
            <button type="button" className="song-open" onClick={() => onOpen(song)}>
              <span className={song.artist === 'Exercise' ? 'song-tile exercise' : 'song-tile'} aria-hidden="true">
                <Icon name={song.artist === 'Exercise' ? 'exercise' : 'notation'} />
              </span>
              <span className="song-text">
                <span className="song-row-title">{song.title}</span>
                <span className="song-row-meta">
                  {[
                    song.artist,
                    `Opened ${formatOpened(song.lastOpenedAt)}`,
                    practiceText(progress.get(song.id)),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {progress.has(song.id) && <Mastery progress={progress.get(song.id)!} />}
              </span>
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove ${song.title}`}
              title="Remove from library"
              onClick={() => onDelete(song)}
            >
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
      <p className="app-version">{versionText()}</p>
    </div>
  )
}
