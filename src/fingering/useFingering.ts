import type * as alphaTab from '@coderline/alphatab'
import { type RefObject, useEffect, useState } from 'react'
import { type Fingerings, trackFingerings } from './fromScore'

/** Writes a small finger number beside each fretted note of the tab, in a layer over the score. */
function draw(element: HTMLElement, api: alphaTab.AlphaTabApi, track: alphaTab.model.Track, fingerings: Fingerings): void {
  const lookup = api.boundsLookup
  const staff = track.staves[0]
  const fragment = document.createDocumentFragment()
  if (lookup && staff) {
    const size = Math.round(Math.min(11, Math.max(7.5, 9 * api.settings.display.scale)) * 10) / 10
    // Roughly how wide one digit is drawn, with its padding.
    const width = size * 0.62 + 2
    for (const bar of staff.bars) {
      for (const voice of bar.voices) {
        for (let index = 0; index < voice.beats.length; index++) {
          const beat = voice.beats[index]
          if (beat.notes.length === 0) continue
          // With standard notation shown a beat is drawn twice; the tab is the lower one.
          const places = lookup.findBeats(beat)
          const notes = places?.[places.length - 1]?.notes
          if (!notes) continue
          // Where the next beat's numbers begin, to see whether there is room beside this one.
          const after = voice.beats[index + 1]
          const afterPlaces = after && after.notes.length > 0 ? lookup.findBeats(after) : null
          const afterNotes = afterPlaces?.[afterPlaces.length - 1]?.notes
          const nextX = afterNotes?.length ? Math.min(...afterNotes.map((place) => place.noteHeadBounds.x)) : Infinity
          const strings = new Set(beat.notes.map((note) => note.string))
          for (const place of notes) {
            // A tied note has no number of its own in the tab.
            if (place.note.isTieDestination) continue
            const fingering = fingerings.get(place.note.id)
            if (!fingering) continue
            const box = place.noteHeadBounds
            const span = document.createElement('span')
            span.className = fingering.source === 'file' ? 'finger finger-file' : 'finger'
            span.textContent = String(fingering.finger)
            span.dataset.note = `${bar.index}:${place.note.string}:${place.note.fret}`
            span.style.fontSize = `${size}px`
            let left = box.x + box.w
            let top = box.y + box.h / 2
            if (left + width > nextX - 1) {
              // No room beside the fret number: the finger goes under it, or over it,
              // wherever the neighbouring string is free in this beat.
              const under = !strings.has(place.note.string - 1)
              if (under || !strings.has(place.note.string + 1)) {
                left = box.x + (box.w - width) / 2
                top = under ? box.y + box.h - 1 : box.y - size + 1
                span.dataset.placed = under ? 'under' : 'over'
              }
            }
            span.style.left = `${left}px`
            span.style.top = `${top}px`
            fragment.append(span)
          }
        }
      }
    }
  }
  element.replaceChildren(fragment)
}

/**
 * The fingering of the track on show, and its numbers drawn over the tab.
 * Worked out again whenever the score is laid out, which covers another
 * song, another track and every edit. Null while switched off.
 */
export function useFingering(
  api: alphaTab.AlphaTabApi | null,
  layerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): Fingerings | null {
  const [fingerings, setFingerings] = useState<Fingerings | null>(null)

  useEffect(() => {
    const element = layerRef.current
    if (!api || !element || !enabled) return
    const update = () => {
      const track = api.tracks[0]
      if (!track) return
      const found = trackFingerings(track)
      draw(element, api, track, found)
      setFingerings(found)
    }
    api.postRenderFinished.on(update)
    // Switched on with a song already on screen.
    if (api.score && api.boundsLookup) update()
    return () => {
      api.postRenderFinished.off(update)
      element.replaceChildren()
      setFingerings(null)
    }
  }, [api, layerRef, enabled])

  return fingerings
}
