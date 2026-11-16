import { sectionAtBar, type SongSection } from '../lib/sections'
import { Icon } from './Icon'

interface Props {
  sections: SongSection[]
  currentBar: number
  /** True during a practice take, which must not be moved to another place. */
  locked: boolean
  onJump: (section: SongSection) => void
  onLoop: (section: SongSection) => void
}

/** The parts of the song marked in the file, for jumping to one or repeating it. */
export function SectionList({ sections, currentBar, locked, onJump, onLoop }: Props) {
  const current = sectionAtBar(sections, currentBar)
  return (
    <ul className="tracks-like sections">
      {sections.map((section, index) => (
        <li key={`${section.startBar}-${section.name}`} className={index === current ? 'section active' : 'section'}>
          <button
            type="button"
            className="section-name"
            aria-current={index === current}
            disabled={locked}
            title={`Go to ${section.name}`}
            onClick={() => onJump(section)}
          >
            <span className="section-title">{section.name}</span>
            <span className="section-detail">
              {section.startBar === section.endBar
                ? `Bar ${section.startBar + 1}`
                : `Bars ${section.startBar + 1}–${section.endBar + 1}`}
            </span>
          </button>
          <button
            type="button"
            className="chip"
            aria-label={`Loop ${section.name}`}
            title="Loop this section"
            disabled={locked}
            onClick={() => onLoop(section)}
          >
            <Icon name="loop" size={14} />
          </button>
        </li>
      ))}
    </ul>
  )
}
