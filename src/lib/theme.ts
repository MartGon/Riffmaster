/**
 * Light or dark colours. The choice belongs to this device: "system" follows
 * the operating system, the others override it. It is shown as a
 * `data-theme` attribute on the root element, which index.css reads.
 */
export type ThemeChoice = 'system' | 'light' | 'dark'

export const THEME_KEY = 'riffmaster.theme'
const SYSTEM_DARK = '(prefers-color-scheme: dark)'

/** Runs before the page is first drawn, so a stored choice shows without a flash of the other theme. */
export const themeBootScript = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`

const listeners = new Set<() => void>()

export function loadTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement
  // Buttons fade their colours on hover; without this they would lag behind the rest of the page.
  root.classList.add('theme-switching')
  if (choice === 'system') delete root.dataset.theme
  else root.dataset.theme = choice
  void root.offsetWidth
  requestAnimationFrame(() => root.classList.remove('theme-switching'))
}

export function setTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, choice)
  } catch {
    // Without storage the choice lasts for this visit only.
  }
  apply(choice)
  for (const listener of listeners) listener()
}

/** The theme in use now: the stored choice, or the system's when there is none. */
export function currentTheme(): ThemeChoice {
  const set = document.documentElement.dataset.theme
  return set === 'light' || set === 'dark' ? set : 'system'
}

/** Whether the dark colours are showing. */
export function isDark(): boolean {
  const choice = currentTheme()
  return choice === 'system' ? window.matchMedia(SYSTEM_DARK).matches : choice === 'dark'
}

/**
 * Calls `onChange` whenever the colours may have changed: a new choice here
 * or in another tab, or the system switching while it is followed.
 */
export function onThemeChange(onChange: () => void): () => void {
  const media = window.matchMedia(SYSTEM_DARK)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_KEY && event.key !== null) return
    apply(loadTheme())
    onChange()
  }
  listeners.add(onChange)
  media.addEventListener('change', onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(onChange)
    media.removeEventListener('change', onChange)
    window.removeEventListener('storage', onStorage)
  }
}
