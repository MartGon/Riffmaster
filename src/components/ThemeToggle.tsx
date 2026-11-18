import { useSyncExternalStore } from 'react'
import { currentTheme, onThemeChange, setTheme, type ThemeChoice } from '../lib/theme'
import { Icon, type IconName } from './Icon'

const order: ThemeChoice[] = ['system', 'light', 'dark']
const names: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' }
const icons: Record<ThemeChoice, IconName> = { system: 'contrast', light: 'sun', dark: 'moon' }

/** A button that steps through the themes: the system's, light, dark. */
export function ThemeToggle() {
  const choice = useSyncExternalStore(onThemeChange, currentTheme, () => 'system' as ThemeChoice)
  const next = order[(order.indexOf(choice) + 1) % order.length]
  const label = `Theme: ${names[choice]}. Switch to ${names[next]}`
  return (
    <button type="button" className="icon-button" aria-label={label} title={label} onClick={() => setTheme(next)}>
      <Icon name={icons[choice]} />
    </button>
  )
}
