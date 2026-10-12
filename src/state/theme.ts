import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useMapPrefs } from './mapPrefs'

// Page theme: follow the system, or force light or dark. Kept in localStorage
// and applied before the first render, so the app never flashes the wrong one.

export type ThemeChoice = 'system' | 'light' | 'dark'

interface ThemeState {
  theme: ThemeChoice
  setTheme(theme: ThemeChoice): void
}

const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

export function isDark(theme: ThemeChoice): boolean {
  return theme === 'dark' || (theme === 'system' && !!media?.matches)
}

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme(theme) {
        set({ theme })
      },
    }),
    {
      name: 'hexplore:theme',
      version: 1,
      storage: createJSONStorage(() => window.localStorage),
      merge: (persisted, current) => {
        const t = (persisted as Partial<ThemeState> | undefined)?.theme
        return { ...current, theme: t === 'light' || t === 'dark' ? t : 'system' }
      },
    },
  ),
)

function apply(dark: boolean) {
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#020617' : '#f1f5f9')
}

/** The light and dark map types follow the page when it switches; other map types are left alone. */
function followMap(dark: boolean) {
  const { basemap, setBasemap } = useMapPrefs.getState()
  if (dark && basemap === 'light') setBasemap('dark')
  if (!dark && basemap === 'dark') setBasemap('light')
}

export function initTheme(): void {
  let dark = isDark(useTheme.getState().theme)
  apply(dark)
  // A first run on a dark system starts on the dark map type too.
  if (dark && localStorage.getItem('hexplore:map') === null) useMapPrefs.getState().setBasemap('dark')
  const update = () => {
    const next = isDark(useTheme.getState().theme)
    if (next === dark) return
    dark = next
    apply(dark)
    followMap(dark)
  }
  useTheme.subscribe(update)
  media?.addEventListener('change', update)
}
