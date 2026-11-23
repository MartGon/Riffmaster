import type { ReactNode } from 'react'
import type { SongPractice } from '../library/db'
import type { Song } from '../library/types'
import { versionText } from '../lib/version'
import { Icon } from './Icon'

interface Props {
  /** Null while the list is being read from storage. */
  songs: Song[] | null
  /** How much each song has been practised, keyed by song id. */
  practice: Map<string, SongPractice>
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

function practiceText(practice: SongPractice | undefined): string {
  if (!practice) return ''
  const takes = practice.takes === 1 ? '1 practice take' : `${practice.takes} practice takes`
  return `${takes}, best ${Math.round(practice.best * 100)}%`
}

export function LibraryView({ songs, practice, busy, onOpen, onDelete, onAdd, onNew, onExercises, onFindNote, plan }: Props) {
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
                    practiceText(practice.get(song.id)),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
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
