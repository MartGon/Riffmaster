import type { NoteGrade } from './matching'

/** A result that is shown on a note. */
export type Mark = Exclude<NoteGrade, 'unscored'>

/**
 * Colours for results, dark enough to read as text on the light paper and
 * light enough on the dark one. The same values are in index.css as
 * `--grade-*`. Results are never shown by colour alone: each also has a shape.
 */
export const gradeColors: Record<'light' | 'dark', Record<Mark, string>> = {
  light: { onTime: '#1e7b34', early: '#b35c00', late: '#b35c00', missed: '#c92a2a' },
  dark: { onTime: '#51cf66', early: '#ffa94d', late: '#ffa94d', missed: '#ff6b6b' },
}

/** Shapes for results, drawn in a 10 by 10 box: a dot, arrows pointing early and late, a cross. */
export const gradeShapes: Record<Mark, string> = {
  onTime: '<circle cx="5" cy="5" r="3.4"/>',
  early: '<path d="M8.5 1v8L1 5z"/>',
  late: '<path d="M1.5 1v8L9 5z"/>',
  missed: '<path class="stroke" d="M1.8 1.8l6.4 6.4M8.2 1.8l-6.4 6.4"/>',
}
