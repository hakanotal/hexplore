import type { PlaceView } from './placeView'
import { haversineKm } from '../pipeline/similarity'
import { isOpenAt } from '../domain/openingHours'

// Options within a group combine with OR; groups combine with AND. Facet counts
// for a group are computed with every other group applied, so each option shows
// how many results picking it would add.

export type StatusValue = 'visited' | 'wantToGo' | 'saved'

export interface Filters {
  q: string
  categories: string[]
  lists: string[]
  status: StatusValue[]
  countries: string[]
  cities: string[]
  neighborhoods: string[]
  tags: string[]
  hasNotes: boolean
  needsReview: boolean
  /** Open at this moment by OSM opening hours, in the device's local time. */
  openNow: boolean
  /** ISO dates, inclusive */
  seenFrom?: string
  seenTo?: string
  /** [west, south, east, north] — "search this area" */
  bbox?: [number, number, number, number]
  near?: { lat: number; lng: number; km: number }
}

export const FACETS = ['categories', 'lists', 'status', 'countries', 'cities', 'neighborhoods', 'tags'] as const
export type Facet = (typeof FACETS)[number]
export type FacetCounts = Record<Facet, Map<string, number>>

export function emptyFilters(): Filters {
  return { q: '', categories: [], lists: [], status: [], countries: [], cities: [], neighborhoods: [], tags: [], hasNotes: false, needsReview: false, openNow: false }
}

export function statusOf(v: PlaceView): StatusValue {
  return v.visited ? 'visited' : v.wantToGo ? 'wantToGo' : 'saved'
}

function facetValues(v: PlaceView, facet: Facet): string[] {
  switch (facet) {
    case 'categories':
      return [v.place.category ?? 'uncategorized']
    case 'lists':
      return v.listIds
    case 'status':
      return [statusOf(v)]
    case 'countries':
      return v.place.country ? [v.place.country] : []
    case 'cities':
      return v.place.city ? [v.place.city] : []
    case 'neighborhoods':
      return v.place.neighborhood ? [v.place.neighborhood] : []
    case 'tags':
      return v.tags
  }
}

function matchesFacet(v: PlaceView, facet: Facet, selected: string[]): boolean {
  if (!selected.length) return true
  const values = facetValues(v, facet)
  return values.some((x) => selected.includes(x))
}

function dayStart(iso: string): number {
  return Date.parse(`${iso}T00:00:00`)
}

/** Non-facet constraints: search, notes, review, hours, dates, area. */
function matchesFixed(v: PlaceView, f: Filters, hits: Map<string, number> | null, now: Date): boolean {
  if (hits && !hits.has(v.id)) return false
  if (f.hasNotes && !v.notes.length) return false
  if (f.needsReview && !v.needsReview) return false
  // Unknown hours do not count as open.
  if (f.openNow && isOpenAt(v.place.openingHours, now) !== true) return false
  if (f.seenFrom && v.place.firstSeenAt < dayStart(f.seenFrom)) return false
  if (f.seenTo && v.place.firstSeenAt >= dayStart(f.seenTo) + 86_400_000) return false
  if (f.bbox) {
    if (v.lat === undefined || v.lng === undefined) return false
    const [w, s, e, n] = f.bbox
    if (v.lat < s || v.lat > n) return false
    if (w <= e ? v.lng < w || v.lng > e : v.lng < w && v.lng > e) return false
  }
  if (f.near) {
    if (v.lat === undefined || v.lng === undefined) return false
    if (haversineKm(f.near, { lat: v.lat, lng: v.lng }) > f.near.km) return false
  }
  return true
}

export interface FilterResult {
  items: PlaceView[]
  counts: FacetCounts
}

export function applyFilters(views: PlaceView[], f: Filters, hits: Map<string, number> | null = null, now = new Date()): FilterResult {
  const counts = Object.fromEntries(FACETS.map((k) => [k, new Map<string, number>()])) as FacetCounts
  const items: PlaceView[] = []
  const selected = FACETS.map((k) => f[k] as string[])

  for (const v of views) {
    if (!matchesFixed(v, f, hits, now)) continue
    let failed: number = -1
    let failures = 0
    for (let i = 0; i < FACETS.length; i++) {
      if (!matchesFacet(v, FACETS[i]!, selected[i]!)) {
        failures++
        failed = i
        if (failures > 1) break
      }
    }
    if (failures > 1) continue
    // Passing all groups counts toward every facet; failing exactly one counts toward that one.
    for (let i = 0; i < FACETS.length; i++) {
      if (failures === 1 && i !== failed) continue
      const map = counts[FACETS[i]!]
      for (const value of facetValues(v, FACETS[i]!)) map.set(value, (map.get(value) ?? 0) + 1)
    }
    if (failures === 0) items.push(v)
  }

  if (hits) items.sort((a, b) => (hits.get(b.id) ?? 0) - (hits.get(a.id) ?? 0))
  return { items, counts }
}

export function activeFilterCount(f: Filters): number {
  return (
    FACETS.reduce((n, k) => n + (f[k] as string[]).length, 0) +
    (f.q ? 1 : 0) +
    (f.hasNotes ? 1 : 0) +
    (f.needsReview ? 1 : 0) +
    (f.openNow ? 1 : 0) +
    (f.seenFrom || f.seenTo ? 1 : 0) +
    (f.bbox ? 1 : 0) +
    (f.near ? 1 : 0)
  )
}

// ---- URL encoding: every view is bookmarkable --------------------------------

const PARAM: Record<Facet, string> = {
  categories: 'cat',
  lists: 'list',
  status: 'status',
  countries: 'country',
  cities: 'city',
  neighborhoods: 'hood',
  tags: 'tag',
}

export function encodeFilters(f: Filters): string {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  for (const k of FACETS) for (const v of f[k] as string[]) p.append(PARAM[k], v)
  if (f.hasNotes) p.set('notes', '1')
  if (f.needsReview) p.set('review', '1')
  if (f.openNow) p.set('open', '1')
  if (f.seenFrom) p.set('from', f.seenFrom)
  if (f.seenTo) p.set('to', f.seenTo)
  if (f.bbox) p.set('bbox', f.bbox.map((x) => x.toFixed(4)).join(','))
  if (f.near) p.set('near', [f.near.lat.toFixed(5), f.near.lng.toFixed(5), f.near.km].join(','))
  return p.toString()
}

export function decodeFilters(query: string): Filters {
  const p = new URLSearchParams(query)
  const f = emptyFilters()
  f.q = p.get('q') ?? ''
  for (const k of FACETS) (f[k] as string[]) = p.getAll(PARAM[k])
  f.status = f.status.filter((s): s is StatusValue => ['visited', 'wantToGo', 'saved'].includes(s))
  f.hasNotes = p.get('notes') === '1'
  f.needsReview = p.get('review') === '1'
  f.openNow = p.get('open') === '1'
  f.seenFrom = p.get('from') ?? undefined
  f.seenTo = p.get('to') ?? undefined
  const bbox = p.get('bbox')?.split(',').map(Number)
  if (bbox?.length === 4 && bbox.every(Number.isFinite)) f.bbox = bbox as Filters['bbox']
  const near = p.get('near')?.split(',').map(Number)
  if (near?.length === 3 && near.every(Number.isFinite)) f.near = { lat: near[0]!, lng: near[1]!, km: near[2]! }
  return f
}
