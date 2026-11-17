import { effectiveTempo, formatTime, MAX_SPEED, MIN_SPEED, SPEED_STEP } from '../lib/format'
import type { PlayerActions, PlayerState } from '../player/usePlayer'
import { Icon, type IconName } from './Icon'

function Toggle(props: {
  icon: IconName
  label: string
  pressed: boolean
  disabled?: boolean
  /** The main action of the row, drawn to stand out. */
  main?: boolean
  onChange: (pressed: boolean) => void
}) {
  return (
    <button
      type="button"
      className={props.main ? 'toggle toggle-main' : 'toggle'}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      title={props.label}
      onClick={() => props.onChange(!props.pressed)}
    >
      <Icon name={props.icon} />
      <span className="toggle-label">{props.label}</span>
    </button>
  )
}

interface Props {
  state: PlayerState
  actions: PlayerActions
  practiceOpen: boolean
  /** True while a practice take is running; the take owns playback until it ends. */
  practiceBusy: boolean
  onTogglePractice: () => void
  fretboardOpen: boolean
  onToggleFretboard: () => void
  fingeringOn: boolean
  onToggleFingering: () => void
  tunerOpen: boolean
  onToggleTuner: () => void
  editorOpen: boolean
  onToggleEditor: () => void
  /** Choosing bars by tapping: null when off, else the first bar tapped so far. */
  picking: { first: number | null } | null
}

export function Transport({
  state,
  actions,
  practiceOpen,
  practiceBusy,
  onTogglePractice,
  fretboardOpen,
  onToggleFretboard,
  fingeringOn,
  onToggleFingering,
  tunerOpen,
  onToggleTuner,
  editorOpen,
  onToggleEditor,
  picking,
}: Props) {
  const ready = state.status === 'ready'
  const playable = ready && state.canPlay && !practiceBusy
  const percent = Math.round(state.speed * 100)

  return (
    <footer className="transport">
      <div className="transport-row">
        <div className="group">
          <button
            type="button"
            className="play"
            disabled={!playable}
            aria-label={state.isPlaying ? 'Pause' : 'Play'}
            title={playable ? 'Play / pause (Space)' : 'Loading sounds…'}
            onClick={actions.playPause}
          >
            <Icon name={state.isPlaying ? 'pause' : 'play'} size={22} />
          </button>
          <button
            type="button"
            className="icon-button"
            disabled={!playable}
            aria-label="Stop"
            title="Stop"
            onClick={actions.stop}
          >
            <Icon name="stop" />
          </button>
        </div>

        <div className="seek">
          <span className="time">{formatTime(state.currentTime)}</span>
          <input
            type="range"
            aria-label="Position"
            min={0}
            max={Math.max(1, state.endTick)}
            value={Math.min(state.currentTick, Math.max(1, state.endTick))}
            disabled={!playable || state.endTick <= 0}
            onChange={(event) => actions.seek(Number(event.target.value))}
          />
          <span className="time">{formatTime(state.endTime)}</span>
        </div>

        <div className="group tempo">
          <button
            type="button"
            className="icon-button"
            disabled={!ready || state.speed <= MIN_SPEED}
            aria-label="Slower"
            title="Slower"
            onClick={() => actions.setSpeed(state.speed - SPEED_STEP)}
          >
            <Icon name="minus" />
          </button>
          <input
            type="range"
            aria-label="Tempo"
            min={MIN_SPEED}
            max={MAX_SPEED}
            step={SPEED_STEP}
            value={state.speed}
            disabled={!ready}
            onChange={(event) => actions.setSpeed(Number(event.target.value))}
          />
          <button
            type="button"
            className="icon-button"
            disabled={!ready || state.speed >= MAX_SPEED}
            aria-label="Faster"
            title="Faster"
            onClick={() => actions.setSpeed(state.speed + SPEED_STEP)}
          >
            <Icon name="plus" />
          </button>
          <button
            type="button"
            className="tempo-readout"
            disabled={!ready || state.speed === 1}
            title="Reset to the written tempo"
            onClick={() => actions.setSpeed(1)}
          >
            <strong>{ready ? effectiveTempo(state.baseTempo, state.speed) : '–'}</strong> bpm
            <span className="tempo-percent">{percent}%</span>
          </button>
        </div>
      </div>

      <div className="transport-row">
        <div className="group toggles">
          <div className="toggle-group" role="group" aria-label="Playback">
            <Toggle
              icon="loop"
              label="Loop"
              pressed={state.isLooping}
              disabled={!ready || practiceBusy}
              onChange={actions.setLooping}
            />
            {/* One place for choosing bars and clearing them, so the row stays short on a phone. */}
            {picking ? (
              <button
                type="button"
                className="toggle"
                aria-pressed="true"
                title="Stop selecting bars"
                disabled={practiceBusy}
                onClick={actions.cancelPicking}
              >
                <Icon name="select" />
                <span className="toggle-label">Selecting…</span>
              </button>
            ) : state.hasLoopRange ? (
              <button
                type="button"
                className="toggle"
                title="Clear selection"
                aria-label="Clear selection"
                disabled={practiceBusy}
                onClick={actions.clearLoopRange}
              >
                <Icon name="close" />
                <span className="toggle-label">Clear selection</span>
              </button>
            ) : (
              <button
                type="button"
                className="toggle"
                title="Select bars: tap the first bar, then the last"
                aria-label="Select bars"
                disabled={!ready || practiceBusy}
                onClick={actions.startPicking}
              >
                <Icon name="select" />
                <span className="toggle-label">Select bars</span>
              </button>
            )}
            <Toggle
              icon="metronome"
              label="Metronome"
              pressed={state.metronome}
              disabled={!ready}
              onChange={actions.setMetronome}
            />
            <Toggle
              icon="countIn"
              label="Count-in"
              pressed={state.countIn}
              disabled={!ready}
              onChange={actions.setCountIn}
            />
          </div>
          <div className="toggle-group" role="group" aria-label="View">
            <Toggle
              icon="notation"
              label="Notation"
              pressed={state.showNotation}
              disabled={!ready || practiceBusy}
              onChange={actions.setShowNotation}
            />
            <Toggle
              icon="fretboard"
              label="Fretboard"
              pressed={fretboardOpen}
              disabled={!ready}
              onChange={onToggleFretboard}
            />
            <Toggle
              icon="fingering"
              label="Fingering"
              pressed={fingeringOn}
              disabled={!ready}
              onChange={onToggleFingering}
            />
          </div>
          <div className="toggle-group" role="group" aria-label="Tools">
            <Toggle
              icon="tuner"
              label="Tuner"
              pressed={tunerOpen}
              disabled={!ready || practiceBusy}
              onChange={onToggleTuner}
            />
            <Toggle
              icon="edit"
              label="Edit"
              pressed={editorOpen}
              disabled={!ready || practiceBusy}
              onChange={onToggleEditor}
            />
            <Toggle
              icon="mic"
              label="Practice"
              main
              pressed={practiceOpen}
              disabled={!ready || !state.canPlay}
              onChange={onTogglePractice}
            />
          </div>
        </div>
      </div>
    </footer>
  )
}
