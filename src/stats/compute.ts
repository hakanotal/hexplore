import type { ImportRecord, List, Membership, Place, UserData } from '../domain/types'
import { categoryLabel } from '../domain/taxonomy'
import { buildViews, type PlaceView } from '../query/placeView'

// Everything the stats screen shows, computed in one pass in the data worker.
// Pure, so it is tested without IndexedDB. Counts cover the places currently on
// the map (at least one active list membership, a pin or a logged visit).

export interface StatsInput {
  places: Place[]
  memberships: Membership[]
  lists: List[]
  userData: UserData[]
  imports: ImportRecord[]
}

/** One group of places: all saved, how many visited, how many still wanted. */
export interface Row {
  /** Filter value: country or city name, category id, tag. */
  key: string
  label: string
  saved: number
  visited: number
  wantToGo: number
}

export interface CountryRow extends Row {
  code?: string
}

export interface CityRow extends Row {
  country?: string
  neighborhoods: number
  visitedNeighborhoods: number
}

export interface Conversion {
  key: string
  label: string
  /** Places that were ever on a want-to-go list. */
  wanted: number
  /** Of those, the ones visited by now. */
  visited: number
}

export interface MonthRow {
  /** YYYY-MM in local time */
  month: string
  added: number
  visits: number
}

export interface Stats {
  totals: {
    saved: number
    visited: number
    wantToGo: number
    favorites: number
    located: number
    countries: number
    visitedCountries: number
    cities: number
    visitedCities: number
    neighborhoods: number
    visitedNeighborhoods: number
  }
  countries: CountryRow[]
  cities: CityRow[]
  categories: Row[]
  tags: Row[]
  cuisines: Row[]
  backlog: {
    wantByCity: Row[]
    oldest: { id: string; title: string; city?: string; since: number }[]
    conversion: Conversion
    conversionByCity: Conversion[]
    conversionByCategory: Conversion[]
  }
  growth: {
    /** Date of the first import; places from it carry no real save date. */
    trackingSince?: number
    beforeTracking: number
    months: MonthRow[]
  }
}

class Rows<R extends Row> {
  readonly map = new Map<string, R>()
  private readonly make: (key: string, label: string) => R

  constructor(make: (key: string, label: string) => R) {
    this.make = make
  }

  add(key: string, label: string, v: PlaceView): R {
    let row = this.map.get(key)
    if (!row) this.map.set(key, (row = this.make(key, label)))
    row.saved++
    if (v.visited) row.visited++
    if (v.wantToGo) row.wantToGo++
    return row
  }

  sorted(): R[] {
    return [...this.map.values()].sort((a, b) => b.visited - a.visited || b.saved - a.saved || a.label.localeCompare(b.label))
  }
}

const row = (key: string, label: string): Row => ({ key, label, saved: 0, visited: 0, wantToGo: 0 })

export function monthKey(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nextMonth(key: string): string {
  const [y, m] = key.split('-').map(Number) as [number, number]
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

const GENERIC_RESTAURANT = new Set(['restaurant', 'fast_food_restaurant', 'meal_takeaway'])

/** Cuisines from OSM's cuisine tag and Google's *_restaurant types. */
function cuisinesOf(p: Place): string[] {
  const out = new Set<string>()
  for (const c of p.osmTags?.cuisine?.split(';') ?? []) if (c.trim()) out.add(c.trim().toLowerCase())
  for (const t of p.googleTypes ?? []) {
    if (t === 'steak_house') out.add('steak')
    else if (t.endsWith('_restaurant') && !GENERIC_RESTAURANT.has(t)) out.add(t.slice(0, -'_restaurant'.length))
  }
  return [...out]
}

function pretty(s: string): string {
  const t = s.replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function computeStats(input: StatsInput, now = Date.now()): Stats {
  const views = buildViews(input)
  const wantLists = new Set(input.lists.filter((l) => l.role === 'wantToGo').map((l) => l.id))
  // Removed memberships count too: a place that left Want to go for Visited was wanted.
  const everWanted = new Set(input.memberships.filter((m) => wantLists.has(m.listId)).map((m) => m.placeId))

  const countries = new Rows<CountryRow>((key, label) => ({ ...row(key, label) }))
  const cities = new Rows<CityRow>((key, label) => ({ ...row(key, label), neighborhoods: 0, visitedNeighborhoods: 0 }))
  const cityCountry = new Map<string, Map<string, number>>()
  const hoods = new Map<string, { city: string; visited: boolean }>()
  const categories = new Rows<Row>(row)
  const tags = new Rows<Row>(row)
  const cuisines = new Rows<Row>(row)
  const convCity = new Map<string, Conversion>()
  const convCategory = new Map<string, Conversion>()
  const conversion: Conversion = { key: 'all', label: 'All places', wanted: 0, visited: 0 }

  const trackingSince = input.imports.length ? Math.min(...input.imports.map((i) => i.date)) : undefined
  const added = new Map<string, number>()
  const visits = new Map<string, number>()
  let beforeTracking = 0
  let located = 0
  let favorites = 0

  for (const v of views) {
    const p = v.place
    if (v.lat !== undefined) located++
    if (v.favorite) favorites++
    if (p.country) countries.add(p.country, p.country, v).code ??= p.countryCode
    if (p.city) {
      cities.add(p.city, p.city, v)
      if (p.country) {
        const counts = cityCountry.get(p.city) ?? new Map<string, number>()
        counts.set(p.country, (counts.get(p.country) ?? 0) + 1)
        cityCountry.set(p.city, counts)
      }
      if (p.neighborhood) {
        const key = `${p.city}\u0000${p.neighborhood}`
        const h = hoods.get(key)
        hoods.set(key, { city: p.city, visited: (h?.visited ?? false) || v.visited })
      }
    }
    const cat = p.category ?? 'uncategorized'
    categories.add(cat, cat === 'uncategorized' ? 'Uncategorized' : categoryLabel(cat), v)
    for (const t of v.tags) tags.add(t, t, v)
    for (const c of cuisinesOf(p)) cuisines.add(c, pretty(c), v)

    if (everWanted.has(v.id)) {
      conversion.wanted++
      if (v.visited) conversion.visited++
      for (const [map, key, label] of [
        [convCity, p.city, p.city],
        [convCategory, cat, cat === 'uncategorized' ? 'Uncategorized' : categoryLabel(cat)],
      ] as const) {
        if (!key) continue
        const c = map.get(key) ?? { key, label: label ?? key, wanted: 0, visited: 0 }
        c.wanted++
        if (v.visited) c.visited++
        map.set(key, c)
      }
    }

    if (trackingSince !== undefined && p.firstSeenAt <= trackingSince) beforeTracking++
    else added.set(monthKey(p.firstSeenAt), (added.get(monthKey(p.firstSeenAt)) ?? 0) + 1)
    for (const visit of v.user?.visits ?? []) visits.set(monthKey(visit.date), (visits.get(monthKey(visit.date)) ?? 0) + 1)
  }

  for (const h of hoods.values()) {
    const c = cities.map.get(h.city)!
    c.neighborhoods++
    if (h.visited) c.visitedNeighborhoods++
  }
  for (const [city, counts] of cityCountry) cities.map.get(city)!.country = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]

  const months: MonthRow[] = []
  const keys = [...added.keys(), ...visits.keys()]
  if (trackingSince !== undefined) keys.push(monthKey(trackingSince))
  if (keys.length) {
    const last = monthKey(now)
    for (let m = keys.sort()[0]!; m <= last; m = nextMonth(m)) months.push({ month: m, added: added.get(m) ?? 0, visits: visits.get(m) ?? 0 })
  }

  const cityRows = cities.sorted()
  const byConversion = (map: Map<string, Conversion>) => [...map.values()].sort((a, b) => b.wanted - a.wanted || a.label.localeCompare(b.label))

  return {
    totals: {
      saved: views.length,
      visited: views.filter((v) => v.visited).length,
      wantToGo: views.filter((v) => v.wantToGo).length,
      favorites,
      located,
      countries: countries.map.size,
      visitedCountries: [...countries.map.values()].filter((r) => r.visited).length,
      cities: cities.map.size,
      visitedCities: cityRows.filter((r) => r.visited).length,
      neighborhoods: hoods.size,
      visitedNeighborhoods: [...hoods.values()].filter((h) => h.visited).length,
    },
    countries: countries.sorted(),
    cities: cityRows,
    categories: categories.sorted(),
    tags: tags.sorted().slice(0, 20),
    cuisines: cuisines.sorted().slice(0, 12),
    backlog: {
      wantByCity: cityRows.filter((r) => r.wantToGo).sort((a, b) => b.wantToGo - a.wantToGo || a.label.localeCompare(b.label)),
      oldest: views
        .filter((v) => v.wantToGo)
        .sort((a, b) => a.place.firstSeenAt - b.place.firstSeenAt || a.place.title.localeCompare(b.place.title))
        .slice(0, 10)
        .map((v) => ({ id: v.id, title: v.place.title, city: v.place.city, since: v.place.firstSeenAt })),
      conversion,
      conversionByCity: byConversion(convCity).slice(0, 10),
      conversionByCategory: byConversion(convCategory),
    },
    growth: { trackingSince, beforeTracking, months },
  }
}
