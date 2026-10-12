import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type BasemapId = 'light' | 'streets' | 'dark' | 'satellite'
export type DetailId = 'transit' | 'traffic' | 'terrain' | 'buildings' | 'heatmap' | 'globe'
export type MapDetails = Record<DetailId, boolean>

export const BASEMAP_IDS: BasemapId[] = ['light', 'streets', 'dark', 'satellite']
export const DETAIL_IDS: DetailId[] = ['transit', 'traffic', 'terrain', 'buildings', 'heatmap', 'globe']

export const DEFAULT_DETAILS: MapDetails = { transit: false, traffic: false, terrain: false, buildings: false, heatmap: false, globe: false }

interface MapPrefsState {
  basemap: BasemapId
  details: MapDetails
  /** TomTom key for live traffic. Kept in this browser only, so it never reaches a backup. */
  trafficKey: string
  /** Set when TomTom rejects the key. Not persisted. */
  trafficError: string | null

  setBasemap(id: BasemapId): void
  toggleDetail(id: DetailId): void
  setTrafficKey(key: string): void
  setTrafficError(message: string | null): void
}

type Persisted = Pick<MapPrefsState, 'basemap' | 'details' | 'trafficKey'>

/** Reads stored prefs defensively: unknown ids and missing details fall back to defaults. */
export function restorePrefs(stored: unknown): Persisted {
  const p = (stored ?? {}) as Partial<Persisted>
  const details = { ...DEFAULT_DETAILS }
  for (const id of DETAIL_IDS) if (typeof p.details?.[id] === 'boolean') details[id] = p.details[id]
  return {
    basemap: p.basemap && BASEMAP_IDS.includes(p.basemap) ? p.basemap : 'light',
    details,
    trafficKey: typeof p.trafficKey === 'string' ? p.trafficKey : '',
  }
}

// A per-device view preference, read synchronously so the map starts in the
// chosen style instead of flashing the default first. Dexie settings are async.
export const useMapPrefs = create<MapPrefsState>()(
  persist(
    (set, get) => ({
      basemap: 'light',
      details: DEFAULT_DETAILS,
      trafficKey: '',
      trafficError: null,

      setBasemap(basemap) {
        set({ basemap })
      },
      toggleDetail(id) {
        set({ details: { ...get().details, [id]: !get().details[id] } })
      },
      setTrafficKey(key) {
        set({ trafficKey: key.trim(), trafficError: null })
      },
      setTrafficError(trafficError) {
        if (trafficError !== get().trafficError) set({ trafficError })
      },
    }),
    {
      name: 'hexplore:map',
      version: 1,
      storage: createJSONStorage(() => window.localStorage),
      partialize: (s): Persisted => ({ basemap: s.basemap, details: s.details, trafficKey: s.trafficKey }),
      merge: (persisted, current) => ({ ...current, ...restorePrefs(persisted) }),
    },
  ),
)
