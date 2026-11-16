import * as alphaTab from '@coderline/alphatab'
import { gradeColors, gradeShapes, type Mark } from './grades'

type Note = alphaTab.model.Note

/** Colours notes in the tab by their result, for the light or the dark theme. The score must be drawn again afterwards. */
export function colourNotes(marks: Map<Note, Mark>, dark: boolean): void {
  const colours = gradeColors[dark ? 'dark' : 'light']
  for (const [note, mark] of marks) {
    const colour = alphaTab.model.Color.fromJson(colours[mark])
    const style = new alphaTab.model.NoteStyle()
    style.colors.set(alphaTab.model.NoteSubElement.GuitarTabFretNumber, colour)
    style.colors.set(alphaTab.model.NoteSubElement.StandardNotationNoteHead, colour)
    note.style = style
  }
}

/**
 * Draws a small result mark beside notes in the tab. The marks sit in a
 * layer over the score, so they can change many times a second while the
 * song plays without the score being drawn again.
 */
export class MarkLayer {
  private readonly element: HTMLElement
  private readonly api: alphaTab.AlphaTabApi
  private readonly drawn = new Map<Note, { mark: Mark; elements: HTMLElement[] }>()

  constructor(element: HTMLElement, api: alphaTab.AlphaTabApi) {
    this.element = element
    this.api = api
  }

  /** Shows exactly these marks, changing only what differs from before. */
  set(marks: Map<Note, Mark>): void {
    for (const [note, entry] of this.drawn) {
      if (marks.get(note) === entry.mark) continue
      for (const element of entry.elements) element.remove()
      this.drawn.delete(note)
    }
    for (const [note, mark] of marks) {
      if (!this.drawn.has(note)) this.drawn.set(note, { mark, elements: this.draw(note, mark) })
    }
  }

  /** Puts the marks back in place after the score has been laid out again. */
  redraw(): void {
    for (const [note, entry] of this.drawn) {
      for (const element of entry.elements) element.remove()
      entry.elements = this.draw(note, entry.mark)
    }
  }

  clear(): void {
    this.element.replaceChildren()
    this.drawn.clear()
  }

  private draw(note: Note, mark: Mark): HTMLElement[] {
    const elements: HTMLElement[] = []
    // With standard notation shown a note appears twice: as a head and as a fret number.
    const places = (this.api.boundsLookup?.findBeats(note.beat) ?? []).flatMap((beat) => beat.notes ?? [])
    for (const noteBounds of places) {
      if (noteBounds.note !== note) continue
      const box = noteBounds.noteHeadBounds
      const element = document.createElement('span')
      element.className = `mark mark-${mark}`
      element.style.left = `${box.x + box.w - 2}px`
      element.style.top = `${box.y - 6}px`
      element.innerHTML = `<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">${gradeShapes[mark]}</svg>`
      this.element.append(element)
      elements.push(element)
    }
    return elements
  }
}
