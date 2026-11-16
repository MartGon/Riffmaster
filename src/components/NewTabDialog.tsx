import { createSong, INSTRUMENTS } from '../editor/newSong'
import { wholeNumber } from '../lib/numbers'
import { FormDialog } from './FormDialog'

interface Props {
  /** Stores the new file; resolves to an error message, or nothing when it worked. */
  onCreate: (data: ArrayBuffer, title: string, artist: string) => Promise<string | void>
  onClose: () => void
}

/** Starts a blank tab: one track of empty bars, ready for the editor. */
export function NewTabDialog({ onCreate, onClose }: Props) {
  return (
    <FormDialog
      title="New tab"
      submitLabel="Create"
      fields={[
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'artist', label: 'Artist', type: 'text' },
        {
          name: 'instrument',
          label: 'Instrument',
          type: 'select',
          options: INSTRUMENTS.map((instrument) => ({ value: instrument.id, label: instrument.label })),
        },
        { name: 'tempo', label: 'Tempo (bpm)', type: 'number', min: 20, max: 400, required: true, group: 'timing' },
        { name: 'numerator', label: 'Beats per bar', type: 'number', min: 1, max: 32, required: true, group: 'timing' },
        {
          name: 'denominator',
          label: 'Beat value',
          type: 'select',
          group: 'timing',
          options: ['2', '4', '8', '16'].map((value) => ({ value, label: value })),
        },
        { name: 'bars', label: 'Bars', type: 'number', min: 1, max: 999, required: true },
      ]}
      initial={{ title: '', artist: '', instrument: INSTRUMENTS[0].id, tempo: '120', numerator: '4', denominator: '4', bars: '16' }}
      onSubmit={async (values) => {
        const title = values.title.trim()
        if (!title) return 'The tab needs a title.'
        const tempo = wholeNumber(values.tempo, 20, 400)
        const numerator = wholeNumber(values.numerator, 1, 32)
        const bars = wholeNumber(values.bars, 1, 999)
        if (tempo === null) return 'The tempo must be a whole number from 20 to 400.'
        if (numerator === null) return 'Beats per bar must be from 1 to 32.'
        if (bars === null) return 'The number of bars must be from 1 to 999.'
        const instrument = INSTRUMENTS.find((item) => item.id === values.instrument) ?? INSTRUMENTS[0]
        const bytes = createSong({
          title,
          artist: values.artist.trim(),
          instrument,
          tempo,
          numerator,
          denominator: Number(values.denominator),
          bars,
        })
        const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        return onCreate(data, title, values.artist.trim())
      }}
      onClose={onClose}
    />
  )
}
