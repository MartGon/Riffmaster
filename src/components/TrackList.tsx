import { MAX_VOLUME } from '../lib/prefs'
import type { PlayerActions, TrackInfo } from '../player/usePlayer'

interface Props {
  tracks: TrackInfo[]
  activeTrack: number
  actions: PlayerActions
  /** True during a practice take, which is tied to the track it started on. */
  locked?: boolean
  onPick?: () => void
}

export function TrackList({ tracks, activeTrack, actions, locked = false, onPick }: Props) {
  return (
    <ul className="tracks">
      {tracks.map((track) => (
        <li key={track.index} className={track.index === activeTrack ? 'track active' : 'track'}>
          <button
            type="button"
            className="track-name"
            title={track.name}
            aria-current={track.index === activeTrack}
            disabled={locked && track.index !== activeTrack}
            onClick={() => {
              actions.showTrack(track.index)
              onPick?.()
            }}
          >
            <span className="track-title">{track.label}</span>
            {track.detail && <span className="track-detail">{track.detail}</span>}
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={track.muted}
            aria-label={`Mute ${track.name}`}
            title="Mute"
            onClick={() => actions.setTrackMuted(track.index, !track.muted)}
          >
            M
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={track.solo}
            aria-label={`Solo ${track.name}`}
            title="Solo"
            onClick={() => actions.setTrackSolo(track.index, !track.solo)}
          >
            S
          </button>
          <label className="track-volume" title={`Volume ${Math.round(track.volume * 100)}%`}>
            <input
              type="range"
              min={0}
              max={MAX_VOLUME}
              step={0.05}
              value={track.volume}
              aria-label={`Volume of ${track.name}`}
              aria-valuetext={`${Math.round(track.volume * 100)}%`}
              onChange={(event) => actions.setTrackVolume(track.index, Number(event.target.value))}
              onDoubleClick={() => actions.setTrackVolume(track.index, 1)}
            />
            <span className="volume-value">{Math.round(track.volume * 100)}%</span>
          </label>
        </li>
      ))}
    </ul>
  )
}
