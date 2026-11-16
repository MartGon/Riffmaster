import * as alphaTab from '@coderline/alphatab'
import { useState } from 'react'
import { NOTE_VALUES, type NoteValue } from '../editor/duration'
import { INSTRUMENTS } from '../editor/newSong'
import {
  addTrack,
  deleteBars,
  deleteTrack,
  FLAG_LABELS,
  fillBar,
  insertBars,
  type NoteFlag,
  setRepeatEnd,
  setSection,
  setSongInfo,
  setTimeSignature,
  setTrackInfo,
  toggleRepeatStart,
} from '../editor/ops'
import type { EditorActions, EditorState } from '../editor/useEditor'
import { wholeNumber } from '../lib/numbers'
import { ChoiceDialog, FormDialog, MenuDialog } from './FormDialog'
import { Icon } from './Icon'

const VALUE_LABELS: Record<NoteValue, string> = {
  1: '1',
  2: '½',
  4: '¼',
  8: '⅛',
  16: '1/16',
  32: '1/32',
  64: '1/64',
}
const VALUE_NAMES: Record<NoteValue, string> = {
  1: 'Whole note',
  2: 'Half note',
  4: 'Quarter note',
  8: 'Eighth note',
  16: 'Sixteenth note',
  32: '32nd note',
  64: '64th note',
}

/** Technique buttons: short label and shortcut key. */
const FLAGS: { flag: NoteFlag; short: string; key: string }[] = [
  { flag: 'hammer', short: 'H/P', key: 'H' },
  { flag: 'slide', short: 'Slide', key: 'S' },
  { flag: 'bend', short: 'Bend', key: 'B' },
  { flag: 'vibrato', short: 'Vib', key: 'V' },
  { flag: 'tie', short: 'Tie', key: 'T' },
  { flag: 'palmMute', short: 'P.M.', key: 'P' },
  { flag: 'letRing', short: 'Ring', key: 'L' },
  { flag: 'dead', short: '×', key: 'X' },
  { flag: 'ghost', short: '( )', key: 'G' },
  { flag: 'accent', short: '>', key: 'A' },
]

const SHORTCUTS: [string, string][] = [
  ['0–9', 'Fret on the string under the cursor (two digits quickly for 10–24)'],
  ['← →', 'Previous / next beat; past the end of a bar adds a beat or a bar'],
  ['↑ ↓', 'Higher / lower string'],
  ['Ctrl ← →', 'Previous / next bar'],
  ['Delete', 'Delete the note; with Shift, delete the beat'],
  ['I or Insert', 'Insert a rest before the cursor'],
  ['R', 'Turn the beat into a rest'],
  ['+ −', 'Longer / shorter note'],
  ['. /', 'Dotted / triplet'],
  ['H S B V T P L X G A', 'Hammer-on, slide, bend, vibrato, tie, palm mute, let ring, dead, ghost, accent'],
  ['Ctrl Z, Ctrl Y', 'Undo, redo'],
  ['Ctrl C, Ctrl V', 'Copy the selected bars (or the cursor’s bar), paste at the cursor'],
  ['Ctrl S', 'Save'],
  ['Space', 'Play / pause'],
]

function pitchName(midi: number): string {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`
}

/** Open-string pitches a tuning can use, from B0 to G5. */
const PITCHES = Array.from({ length: 80 - 23 }, (_, index) => 23 + index).map((midi) => ({
  value: String(midi),
  label: pitchName(midi),
}))

type Dialog =
  | 'song'
  | 'track'
  | 'addTrack'
  | 'deleteTrack'
  | 'timeSignature'
  | 'repeatEnd'
  | 'section'
  | 'restore'
  | 'help'
  | 'more'
  | null

interface Props {
  state: EditorState
  actions: EditorActions
  score: alphaTab.model.Score | null
  hasOriginal: boolean
  onRestoreOriginal: () => void
  onClose: () => void
}

export function EditorPanel({ state, actions, score, hasOriginal, onRestoreOriginal, onClose }: Props) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const [keypad, setKeypad] = useState(() => window.matchMedia('(pointer: coarse)').matches)
  const { cursor, rhythm, status } = state
  const disabled = !state.editable || !status
  const track = score?.tracks[cursor.track]
  const staff = track?.staves[0]
  const masterBar = score?.masterBars[cursor.bar]

  const lengthButton = (value: NoteValue) => (
    <button
      key={value}
      type="button"
      className="tool"
      aria-pressed={rhythm.value === value}
      title={VALUE_NAMES[value]}
      aria-label={VALUE_NAMES[value]}
      disabled={disabled}
      onClick={() => actions.setRhythm({ ...rhythm, value })}
    >
      {VALUE_LABELS[value]}
    </button>
  )

  return (
    <section className="editor" aria-label="Tab editor">
      <div className="editor-head">
        <div className="editor-status" aria-live="polite">
          {!state.editable ? (
            <span>This track has no tablature to edit. Pick a guitar or bass track.</span>
          ) : status ? (
            <>
              <strong>{status.position}</strong>
              <span>{status.detail}</span>
              {status.fill && <span className="editor-fill">{status.fill}</span>}
            </>
          ) : null}
        </div>
        <div className="group editor-actions">
          <button
            type="button"
            className="icon-button"
            disabled={!state.canUndo}
            aria-label="Undo"
            title={state.undoLabel ? `Undo ${state.undoLabel.toLowerCase()} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}
            onClick={actions.undo}
          >
            <Icon name="undo" />
          </button>
          <button
            type="button"
            className="icon-button"
            disabled={!state.canRedo}
            aria-label="Redo"
            title={state.redoLabel ? `Redo ${state.redoLabel.toLowerCase()} (Ctrl+Y)` : 'Redo (Ctrl+Y)'}
            onClick={actions.redo}
          >
            <Icon name="redo" />
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!state.dirty || state.saving}
            title="Save (Ctrl+S)"
            onClick={() => void actions.save()}
          >
            {state.saving ? 'Saving…' : state.dirty ? 'Save' : 'Saved'}
          </button>
          <button type="button" className="button" onClick={() => setDialog('more')}>
            More
          </button>
          <button type="button" className="icon-button" aria-label="Close editor" title="Close editor" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </div>

      {state.message && (
        <p className="editor-message" role="status">
          {state.message}
        </p>
      )}

      <div className="editor-tools">
        <div className="tool-group" role="group" aria-label="Note length">
          {NOTE_VALUES.slice(0, 6).map(lengthButton)}
          <button
            type="button"
            className="tool"
            aria-pressed={rhythm.dots > 0}
            title="Dotted (.)"
            disabled={disabled}
            onClick={() => actions.setRhythm({ ...rhythm, dots: rhythm.dots ? 0 : 1 })}
          >
            Dot
          </button>
          <button
            type="button"
            className="tool"
            aria-pressed={rhythm.triplet}
            title="Triplet (/)"
            disabled={disabled}
            onClick={() => actions.setRhythm({ ...rhythm, triplet: !rhythm.triplet })}
          >
            3
          </button>
          <button type="button" className="tool" title="Rest (R)" disabled={disabled} onClick={actions.makeRest}>
            Rest
          </button>
        </div>

        <div className="tool-group" role="group" aria-label="Technique">
          {FLAGS.map(({ flag, short, key }) => (
            <button
              key={flag}
              type="button"
              className="tool"
              aria-pressed={state.flags[flag]}
              aria-label={FLAG_LABELS[flag]}
              title={`${FLAG_LABELS[flag]} (${key})`}
              disabled={disabled || !state.hasNote}
              onClick={() => actions.toggleFlag(flag)}
            >
              {short}
            </button>
          ))}
        </div>

        <div className="tool-group" role="group" aria-label="Beat">
          <button type="button" className="tool" title="Insert a rest before the cursor (I)" disabled={disabled} onClick={actions.insertBeat}>
            + Beat
          </button>
          <button type="button" className="tool" title="Delete the beat (Shift+Delete)" disabled={disabled} onClick={actions.deleteBeat}>
            − Beat
          </button>
          <button
            type="button"
            className="tool"
            title="Fill the rest of the bar with rests"
            disabled={disabled || !status?.fill || status.fill.includes('too long')}
            onClick={() => actions.commit(fillBar)}
          >
            Fill
          </button>
        </div>

        <div className="tool-group" role="group" aria-label="Bar">
          <button
            type="button"
            className="tool"
            title="Insert an empty bar before this one"
            disabled={disabled}
            onClick={() => actions.commit((song, at) => insertBars(song, at.bar, 1, at))}
          >
            + Bar before
          </button>
          <button
            type="button"
            className="tool"
            title="Insert an empty bar after this one"
            disabled={disabled}
            onClick={() => actions.commit((song, at) => insertBars(song, at.bar + 1, 1, at))}
          >
            + Bar after
          </button>
          <button
            type="button"
            className="tool"
            title="Delete this bar from every track"
            disabled={disabled || (score?.masterBars.length ?? 0) <= 1}
            onClick={() => actions.commit((song, at) => deleteBars(song, at.bar, 1, at))}
          >
            − Bar
          </button>
          <button type="button" className="tool" title="Time signature" disabled={disabled} onClick={() => setDialog('timeSignature')}>
            {status?.timeSignature ?? '4/4'}
          </button>
          <button
            type="button"
            className="tool"
            aria-pressed={status?.repeatStart ?? false}
            title="Repeat starts at this bar"
            disabled={disabled}
            onClick={() => actions.commit((song, at) => toggleRepeatStart(song, at.bar, at))}
          >
            |:
          </button>
          <button
            type="button"
            className="tool"
            aria-pressed={(status?.repeatCount ?? 0) > 0}
            title="Repeat ends at this bar"
            disabled={disabled}
            onClick={() => setDialog('repeatEnd')}
          >
            :|{status && status.repeatCount > 0 ? ` ×${status.repeatCount}` : ''}
          </button>
          <button
            type="button"
            className="tool"
            aria-pressed={!!status?.section}
            title="Section starting at this bar"
            disabled={disabled}
            onClick={() => setDialog('section')}
          >
            {status?.section ? `§ ${status.section}` : '§ Section'}
          </button>
          <button
            type="button"
            className="tool"
            title="Copy the selected bars, or this bar (Ctrl+C)"
            disabled={disabled}
            onClick={actions.copy}
          >
            Copy
          </button>
          <button
            type="button"
            className="tool"
            title="Paste over the bars from the cursor on (Ctrl+V)"
            disabled={disabled || state.clipBars === 0}
            onClick={actions.paste}
          >
            Paste{state.clipBars > 0 ? ` ${state.clipBars}` : ''}
          </button>
          <button type="button" className="tool" aria-pressed={keypad} title="On-screen number pad" onClick={() => setKeypad(!keypad)}>
            Keypad
          </button>
        </div>
      </div>

      {keypad && (
        <div className="keypad" role="group" aria-label="Number pad">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((digit) => (
            <button key={digit} type="button" className="tool" disabled={disabled} onClick={() => actions.typeDigit(digit)}>
              {digit}
            </button>
          ))}
          <button type="button" className="tool" aria-label="Higher string" disabled={disabled} onClick={() => actions.move('up')}>
            ↑
          </button>
          <button type="button" className="tool" aria-label="Lower string" disabled={disabled} onClick={() => actions.move('down')}>
            ↓
          </button>
          <button type="button" className="tool" aria-label="Previous beat" disabled={disabled} onClick={() => actions.move('left')}>
            ←
          </button>
          <button type="button" className="tool" aria-label="Next beat" disabled={disabled} onClick={() => actions.move('right')}>
            →
          </button>
          <button type="button" className="tool" aria-label="Delete note" disabled={disabled} onClick={actions.deleteNote}>
            Del
          </button>
        </div>
      )}

      {dialog === 'more' && (
        <MenuDialog
          title="Song and track"
          onClose={() => setDialog(null)}
          items={[
            { label: 'Song details…', disabled: !score, onChoose: () => setDialog('song') },
            { label: 'Track details…', disabled: disabled, onChoose: () => setDialog('track') },
            { label: 'Add track…', disabled: !score, onChoose: () => setDialog('addTrack') },
            { label: 'Delete this track…', disabled: !score || score.tracks.length <= 1, onChoose: () => setDialog('deleteTrack') },
            { label: 'Download as Guitar Pro file', disabled: !score, onChoose: actions.download },
            { label: 'Restore the original file…', disabled: !hasOriginal, onChoose: () => setDialog('restore') },
            { label: 'Keyboard shortcuts', onChoose: () => setDialog('help') },
          ]}
        />
      )}

      {dialog === 'song' && score && (
        <FormDialog
          title="Song details"
          submitLabel="Apply"
          fields={[
            { name: 'title', label: 'Title', type: 'text' },
            { name: 'artist', label: 'Artist', type: 'text' },
            { name: 'tempo', label: 'Tempo (bpm)', type: 'number', min: 20, max: 400, required: true },
          ]}
          initial={{ title: score.title, artist: score.artist, tempo: String(score.tempo) }}
          onSubmit={(values) => {
            const tempo = wholeNumber(values.tempo, 20, 400)
            if (tempo === null) return 'The tempo must be a whole number from 20 to 400.'
            actions.commit((song, at) => setSongInfo(song, { title: values.title.trim(), artist: values.artist.trim(), tempo }, at))
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'track' && track && staff && (
        <FormDialog
          title="Track details"
          submitLabel="Apply"
          intro="Frets stay as they are when the tuning changes, so the notes sound different."
          fields={[
            { name: 'name', label: 'Name', type: 'text', required: true },
            { name: 'capo', label: 'Capo fret (0 for none)', type: 'number', min: 0, max: 12 },
            {
              name: 'preset',
              label: 'Tuning',
              type: 'select',
              options: [
                { value: '', label: 'Custom' },
                ...alphaTab.model.Tuning.getPresetsFor(staff.tuning.length).map((preset, index) => ({
                  value: String(index),
                  label: preset.name,
                })),
              ],
            },
            ...staff.tuning.map((_, index) => ({
              name: `string${index}`,
              label: `String ${index + 1}`,
              type: 'select' as const,
              options: PITCHES,
              group: 'strings',
            })),
          ]}
          initial={{
            name: track.name,
            capo: String(staff.capo),
            preset: presetIndex(staff.tuning),
            ...Object.fromEntries(staff.tuning.map((pitch, index) => [`string${index}`, String(pitch)])),
          }}
          onFieldChange={(name, value, values) => {
            const presets = alphaTab.model.Tuning.getPresetsFor(staff.tuning.length)
            if (name === 'preset' && value !== '') {
              const preset = presets[Number(value)]
              return Object.fromEntries(preset.tunings.map((pitch, index) => [`string${index}`, String(pitch)]))
            }
            if (name.startsWith('string')) {
              return { preset: presetIndex(staff.tuning.map((_, index) => Number(values[`string${index}`]))) }
            }
            return {}
          }}
          onSubmit={(values) => {
            const capo = wholeNumber(values.capo || '0', 0, 12)
            if (capo === null) return 'The capo must be on a fret from 0 to 12.'
            if (!values.name.trim()) return 'The track needs a name.'
            const tuning = staff.tuning.map((_, index) => Number(values[`string${index}`]))
            actions.commit((song, at) => setTrackInfo(song, at.track, { name: values.name.trim(), tuning, capo }, at))
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'addTrack' && score && (
        <FormDialog
          title="Add track"
          submitLabel="Add"
          fields={[
            { name: 'name', label: 'Name', type: 'text', required: true },
            {
              name: 'instrument',
              label: 'Instrument',
              type: 'select',
              options: INSTRUMENTS.map((instrument) => ({ value: instrument.id, label: instrument.label })),
            },
          ]}
          initial={{ name: 'Guitar', instrument: INSTRUMENTS[0].id }}
          onFieldChange={(name, value, values): Record<string, string> => {
            if (name !== 'instrument') return {}
            const label = INSTRUMENTS.find((instrument) => instrument.id === value)?.label.split(',')[0] ?? ''
            const known = INSTRUMENTS.some((instrument) => instrument.label.split(',')[0] === values.name)
            return known || !values.name ? { name: label } : {}
          }}
          onSubmit={(values) => {
            const instrument = INSTRUMENTS.find((item) => item.id === values.instrument) ?? INSTRUMENTS[0]
            const added = actions.commit((song, at) =>
              addTrack(song, { name: values.name.trim() || 'Track', tuning: instrument.tuning, program: instrument.program }, at),
            )
            if (!added) return 'No more tracks can be added: all sound channels are in use.'
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'deleteTrack' && track && (
        <ChoiceDialog
          title="Delete this track?"
          onClose={() => setDialog(null)}
          choices={[
            { label: 'Cancel', onChoose: () => setDialog(null) },
            {
              label: 'Delete track',
              primary: true,
              onChoose: () => {
                actions.commit((song, at) => deleteTrack(song, at.track, at))
                setDialog(null)
              },
            },
          ]}
        >
          “{track.name}” and all its notes will be removed. Undo brings it back until the song is closed.
        </ChoiceDialog>
      )}

      {dialog === 'timeSignature' && masterBar && (
        <FormDialog
          title={`Time signature from bar ${cursor.bar + 1}`}
          submitLabel="Apply"
          intro="Changes this bar and the following bars that had the same time signature."
          fields={[
            { name: 'numerator', label: 'Beats', type: 'number', min: 1, max: 32, required: true, group: 'sig' },
            {
              name: 'denominator',
              label: 'Beat value',
              type: 'select',
              group: 'sig',
              options: ['1', '2', '4', '8', '16', '32'].map((value) => ({ value, label: value })),
            },
          ]}
          initial={{
            numerator: String(masterBar.timeSignatureNumerator),
            denominator: String(masterBar.timeSignatureDenominator),
          }}
          onSubmit={(values) => {
            const numerator = wholeNumber(values.numerator, 1, 32)
            if (numerator === null) return 'The number of beats must be from 1 to 32.'
            actions.commit((song, at) => setTimeSignature(song, at.bar, numerator, Number(values.denominator), at))
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'repeatEnd' && masterBar && (
        <FormDialog
          title={`Repeat ending at bar ${cursor.bar + 1}`}
          submitLabel="Apply"
          fields={[
            {
              name: 'times',
              label: 'Play the passage',
              type: 'select',
              options: [
                { value: '0', label: 'Once (no repeat sign)' },
                ...[2, 3, 4, 5, 6, 7, 8].map((times) => ({ value: String(times), label: `${times} times` })),
              ],
            },
          ]}
          initial={{ times: String(masterBar.repeatCount > 0 ? masterBar.repeatCount : 2) }}
          onSubmit={(values) => {
            actions.commit((song, at) => setRepeatEnd(song, at.bar, Number(values.times), at))
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'section' && masterBar && (
        <FormDialog
          title={`Section starting at bar ${cursor.bar + 1}`}
          submitLabel="Apply"
          intro="Leave the name empty to remove the section marker."
          fields={[{ name: 'name', label: 'Name', type: 'text' }]}
          initial={{ name: masterBar.section?.text ?? '' }}
          onSubmit={(values) => {
            actions.commit((song, at) => setSection(song, at.bar, values.name, at))
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'restore' && (
        <ChoiceDialog
          title="Restore the original file?"
          onClose={() => setDialog(null)}
          choices={[
            { label: 'Cancel', onChoose: () => setDialog(null) },
            {
              label: 'Restore',
              primary: true,
              onChoose: () => {
                setDialog(null)
                onRestoreOriginal()
              },
            },
          ]}
        >
          The song goes back to the file as it was before it was first edited. All saved and unsaved
          edits are lost, and this cannot be undone.
        </ChoiceDialog>
      )}

      {dialog === 'help' && (
        <ChoiceDialog title="Keyboard shortcuts" onClose={() => setDialog(null)} choices={[{ label: 'Close', primary: true, onChoose: () => setDialog(null) }]}>
          <table className="shortcuts">
            <tbody>
              {SHORTCUTS.map(([keys, text]) => (
                <tr key={keys}>
                  <th scope="row">
                    <kbd>{keys}</kbd>
                  </th>
                  <td>{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>Only the first voice of a bar can be edited. Clicking the tab moves the cursor.</p>
        </ChoiceDialog>
      )}
    </section>
  )
}

function presetIndex(tuning: number[]): string {
  const presets = alphaTab.model.Tuning.getPresetsFor(tuning.length)
  const index = presets.findIndex((preset) => preset.tunings.every((pitch, i) => pitch === tuning[i]))
  return index >= 0 ? String(index) : ''
}
