import { create } from 'zustand'
import { getDb } from '../db/db'
import type { List, SavedView } from '../domain/types'
import { deleteView, listSavedViews, saveView } from '../db/viewRepo'
import { applyFilters, decodeFilters, emptyFilters, encodeFilters, FACETS, type Facet, type FacetCounts, type Filters } from '../query/filters'
import { buildViews, type PlaceView } from '../query/placeView'
import { toSearchDocs } from '../query/searchDocs'
import { SpatialIndex } from '../query/spatial'
import type { PipelineProgress } from '../pipeline/runner'
import { haversineKm } from '../pipeline/similarity'
import { searchWorker } from '../workers/client'

export type SheetSnap = 'peek' | 'half' | 'full'
export type SortMode = 'relevance' | 'distance' | 'recent' | 'name'

export interface LatLng {
  lat: number
  lng: number
}

interface AppState {
  ready: boolean
  views: PlaceView[]
  byId: Map<string, PlaceView>
  lists: List[]
  listById: Map<string, List>
  spatial: SpatialIndex | null
  filters: Filters
  hits: Map<string, number> | null
  result: PlaceView[]
  counts: FacetCounts
  sort: SortMode
  selectedId: string | null
  sheet: SheetSnap
  userLocation: LatLng | null
  /** Center of the map, kept for "search this area" and manual pins. */
  mapCenter: LatLng | null
  mapBounds: [number, number, number, number] | null
  /** Bumped to ask the map to fit the current results. */
  fitRequest: number
  pipeline: PipelineProgress | null
  savedViews: SavedView[]
  /** Screen point to map coordinates; provided by the map once it has loaded. */
  pickPoint: ((x: number, y: number) => LatLng) | null

  load(): Promise<void>
  setFilters(patch: Partial<Filters>): void
  /** Replaces every filter at once, e.g. when applying a saved view. */
  replaceFilters(filters: Filters): void
  saveCurrentView(name: string): Promise<void>
  applyView(view: SavedView): void
  removeView(id: string): Promise<void>
  toggleFacet(facet: Facet, value: string): void
  clearFilters(): void
  setQuery(q: string): void
  setSort(sort: SortMode): void
  select(id: string | null): void
  setSheet(s: SheetSnap): void
  setUserLocation(p: LatLng | null): void
  setMapView(center: LatLng, bounds: [number, number, number, number]): void
  requestFit(): void
  setPipeline(p: PipelineProgress | null): void
}

function sortItems(items: PlaceView[], sort: SortMode, loc: LatLng | null, hits: Map<string, number> | null): PlaceView[] {
  switch (sort) {
    case 'relevance':
      return hits ? items : sortItems(items, 'recent', loc, hits)
    case 'distance': {
      if (!loc) return items
      const d = (v: PlaceView) => (v.lat === undefined ? Infinity : haversineKm(loc, { lat: v.lat, lng: v.lng! }))
      return items
        .map((v) => [d(v), v] as const)
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => v)
    }
    case 'recent':
      return [...items].sort((a, b) => b.place.firstSeenAt - a.place.firstSeenAt || a.place.title.localeCompare(b.place.title))
    case 'name':
      return [...items].sort((a, b) => a.place.title.localeCompare(b.place.title))
  }
}

let searchSeq = 0

export const useApp = create<AppState>((set, get) => {
  const recompute = (patch: Partial<AppState> = {}) => {
    const s = { ...get(), ...patch }
    const { items, counts } = applyFilters(s.views, s.filters, s.hits)
    set({ ...patch, result: sortItems(items, s.sort, s.userLocation, s.hits), counts })
  }

  const syncUrl = (filters: Filters) => {
    const qs = encodeFilters(filters)
    const url = `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`
    history.replaceState(history.state, '', url)
  }

  const runSearch = async (q: string) => {
    const seq = ++searchSeq
    const hits = q.trim() ? await searchWorker().search(q) : null
    if (seq === searchSeq) recompute({ hits, sort: hits ? 'relevance' : get().sort === 'relevance' ? 'recent' : get().sort })
  }

  const initialFilters = typeof location !== 'undefined' ? decodeFilters(location.search) : emptyFilters()

  return {
    ready: false,
    views: [],
    byId: new Map(),
    lists: [],
    listById: new Map(),
    spatial: null,
    filters: initialFilters,
    hits: null,
    result: [],
    counts: Object.fromEntries(FACETS.map((k) => [k, new Map()])) as FacetCounts,
    sort: initialFilters.q ? 'relevance' : 'recent',
    selectedId: null,
    sheet: 'peek',
    userLocation: null,
    mapCenter: null,
    mapBounds: null,
    fitRequest: 0,
    pipeline: null,
    savedViews: [],
    pickPoint: null,

    async load() {
      const db = getDb()
      const [places, memberships, lists, userData, savedViews] = await Promise.all([
        db.places.toArray(),
        db.memberships.toArray(),
        db.lists.toArray(),
        db.userData.toArray(),
        listSavedViews(),
      ])
      lists.sort((a, b) => a.name.localeCompare(b.name))
      const views = buildViews({ places, memberships, lists, userData })
      await searchWorker().build(toSearchDocs(views))
      const wasReady = get().ready
      recompute({
        ready: true,
        savedViews,
        views,
        byId: new Map(views.map((v) => [v.id, v])),
        lists,
        listById: new Map(lists.map((l) => [l.id, l])),
        spatial: new SpatialIndex(views),
      })
      if (get().filters.q) await runSearch(get().filters.q)
      if (!wasReady) get().requestFit()
    },

    setFilters(patch) {
      const filters = { ...get().filters, ...patch }
      syncUrl(filters)
      recompute({ filters })
    },

    replaceFilters(filters) {
      syncUrl(filters)
      if (filters.q !== get().filters.q) {
        set({ filters })
        void runSearch(filters.q)
      } else {
        recompute({ filters })
      }
    },

    async saveCurrentView(name) {
      await saveView(name, encodeFilters(get().filters))
      set({ savedViews: await listSavedViews() })
    },

    applyView(view) {
      get().replaceFilters(decodeFilters(view.query))
      get().requestFit()
    },

    async removeView(id) {
      await deleteView(id)
      set({ savedViews: await listSavedViews() })
    },

    toggleFacet(facet, value) {
      const current = get().filters[facet] as string[]
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
      get().setFilters({ [facet]: next } as Partial<Filters>)
    },

    clearFilters() {
      const filters = emptyFilters()
      syncUrl(filters)
      searchSeq++
      recompute({ filters, hits: null, sort: get().sort === 'relevance' ? 'recent' : get().sort })
    },

    setQuery(q) {
      const filters = { ...get().filters, q }
      syncUrl(filters)
      set({ filters })
      void runSearch(q)
    },

    setSort(sort) {
      recompute({ sort })
    },

    select(id) {
      set({ selectedId: id, sheet: id ? (get().sheet === 'full' ? 'full' : 'half') : get().sheet })
    },

    setSheet(sheet) {
      set({ sheet })
    },

    setUserLocation(p) {
      recompute({ userLocation: p, sort: p ? 'distance' : get().sort === 'distance' ? 'recent' : get().sort })
    },

    setMapView(center, bounds) {
      set({ mapCenter: center, mapBounds: bounds })
    },

    requestFit() {
      set({ fitRequest: get().fitRequest + 1 })
    },

    setPipeline(pipeline) {
      set({ pipeline })
    },
  }
})
