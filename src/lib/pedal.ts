/** What a foot pedal can do. */
export type PedalAction = 'play' | 'restart' | 'next'

/** The key each action listens for, as `KeyboardEvent.code`; null for none. */
export type PedalKeys = Record<PedalAction, string | null>

/** Bluetooth page-turner pedals send Page Down and Page Up unless set otherwise. */
export const DEFAULT_PEDAL_KEYS: PedalKeys = { play: 'PageDown', restart: 'PageUp', next: null }

/** Keys the app and the browser need for themselves. */
const RESERVED = new Set(['Space', 'Tab', 'Escape', 'Enter', 'NumpadEnter'])
const MODIFIERS = /^(Shift|Control|Alt|Meta|OS)/

const KEY = 'riffmaster.pedal'
const ACTIONS: PedalAction[] = ['play', 'restart', 'next']

/** Whether a key can be given to a pedal action. */
export function canAssign(code: string): boolean {
  return code !== '' && !RESERVED.has(code) && !MODIFIERS.test(code)
}

export function loadPedalKeys(): PedalKeys {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PedalKeys> | null
    if (!stored || typeof stored !== 'object') return { ...DEFAULT_PEDAL_KEYS }
    let keys = { ...DEFAULT_PEDAL_KEYS }
    for (const action of ACTIONS) {
      const value = stored[action]
      // Through the same door as a choice in the dialog, so no key ends up on two actions.
      if (value === null || (typeof value === 'string' && canAssign(value))) keys = assignPedalKey(keys, action, value)
    }
    return keys
  } catch {
    return { ...DEFAULT_PEDAL_KEYS }
  }
}

export function savePedalKeys(keys: PedalKeys): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(keys))
  } catch {
    // Without storage the choice lasts for this visit only.
  }
}

/** Gives a key to an action, taking it from any other action that had it. */
export function assignPedalKey(keys: PedalKeys, action: PedalAction, code: string | null): PedalKeys {
  const next = { ...keys }
  if (code !== null) for (const other of ACTIONS) if (next[other] === code) next[other] = null
  next[action] = code
  return next
}

/** The action a key belongs to, held or not. A key with a modifier is a shortcut of something else. */
export function pedalKeyAction(
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  keys: PedalKeys,
): PedalAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null
  return ACTIONS.find((action) => keys[action] === event.code) ?? null
}

/** Keys a focused slider or list needs in order to be used from the keyboard. */
export function isControlKey(code: string): boolean {
  return /^Arrow/.test(code) || code === 'Home' || code === 'End'
}

/** The key's name for showing. */
export function keyLabel(code: string | null): string {
  if (!code) return 'None'
  const named: Record<string, string> = {
    PageDown: 'Page Down',
    PageUp: 'Page Up',
    ArrowLeft: 'Left arrow',
    ArrowRight: 'Right arrow',
    ArrowUp: 'Up arrow',
    ArrowDown: 'Down arrow',
  }
  return named[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '')
}

/** The section after the current bar, going round to the first. */
export function nextSection<Section extends { startBar: number }>(sections: Section[], currentBar: number): Section | null {
  return sections.find((section) => section.startBar > currentBar) ?? sections[0] ?? null
}
