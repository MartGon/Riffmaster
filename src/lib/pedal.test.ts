import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assignPedalKey, canAssign, DEFAULT_PEDAL_KEYS, isControlKey, keyLabel, loadPedalKeys, nextSection, pedalKeyAction, savePedalKeys } from './pedal'

const press = (code: string, change: Partial<KeyboardEvent> = {}) => ({
  code,
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...change,
})

describe('pedal keys', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    })
  })

  it('finds the action of a key', () => {
    expect(pedalKeyAction(press('PageDown'), DEFAULT_PEDAL_KEYS)).toBe('play')
    expect(pedalKeyAction(press('PageUp'), DEFAULT_PEDAL_KEYS)).toBe('restart')
    expect(pedalKeyAction(press('KeyA'), DEFAULT_PEDAL_KEYS)).toBeNull()
  })

  it('ignores browser shortcuts', () => {
    expect(pedalKeyAction(press('PageDown', { ctrlKey: true }), DEFAULT_PEDAL_KEYS)).toBeNull()
    expect(pedalKeyAction(press('PageDown', { shiftKey: true }), DEFAULT_PEDAL_KEYS)).toBeNull()
  })

  it('gives a key to one action only', () => {
    const keys = assignPedalKey(DEFAULT_PEDAL_KEYS, 'next', 'PageDown')
    expect(keys).toEqual({ play: null, restart: 'PageUp', next: 'PageDown' })
  })

  it('keeps keys the app needs off the pedal', () => {
    for (const code of ['Space', 'Tab', 'Escape', 'Enter', 'ShiftLeft', 'ControlRight', 'MetaLeft']) expect(canAssign(code)).toBe(false)
    expect(canAssign('ArrowRight')).toBe(true)
  })

  it('remembers the keys, and survives damaged storage', () => {
    savePedalKeys({ play: 'ArrowRight', restart: null, next: 'KeyB' })
    expect(loadPedalKeys()).toEqual({ play: 'ArrowRight', restart: null, next: 'KeyB' })
    localStorage.setItem('riffmaster.pedal', '{bad')
    expect(loadPedalKeys()).toEqual(DEFAULT_PEDAL_KEYS)
    localStorage.setItem('riffmaster.pedal', JSON.stringify({ play: 'Space', restart: 3 }))
    expect(loadPedalKeys()).toEqual(DEFAULT_PEDAL_KEYS)
  })

  it('does not leave one key on two actions after damaged storage', () => {
    localStorage.setItem('riffmaster.pedal', JSON.stringify({ play: 'PageUp' }))
    expect(loadPedalKeys()).toEqual({ play: 'PageUp', restart: null, next: null })
  })

  it('still knows a held key as a pedal key, so it can be kept from scrolling', () => {
    expect(pedalKeyAction(press('PageUp', { repeat: true }), DEFAULT_PEDAL_KEYS)).toBe('restart')
  })

  it('leaves arrows, Home and End to a focused slider', () => {
    for (const code of ['ArrowLeft', 'ArrowDown', 'Home', 'End']) expect(isControlKey(code)).toBe(true)
    for (const code of ['PageDown', 'PageUp', 'KeyN']) expect(isControlKey(code)).toBe(false)
  })

  it('names keys for people', () => {
    expect(keyLabel('PageDown')).toBe('Page Down')
    expect(keyLabel('KeyB')).toBe('B')
    expect(keyLabel(null)).toBe('None')
  })

  it('finds the next section, going round at the end', () => {
    const sections = [{ startBar: 0 }, { startBar: 8 }, { startBar: 16 }]
    expect(nextSection(sections, 3)?.startBar).toBe(8)
    expect(nextSection(sections, 8)?.startBar).toBe(16)
    expect(nextSection(sections, 20)?.startBar).toBe(0)
    expect(nextSection([], 3)).toBeNull()
  })
})
