import { describe, expect, it } from 'vitest'
import { buildDemoData } from '../dev/demoData'
import { buildViews } from './placeView'
import { activeFilterCount, applyFilters, decodeFilters, emptyFilters, encodeFilters, type Filters } from './filters'
import { createIndex, search } from './search'
import { toSearchDocs } from './searchDocs'
import { SpatialIndex } from './spatial'
import type { List, Membership, Place } from '../domain/types'

const NOW = Date.UTC(2026, 9, 1)

function place(id: string, extra: Partial<Place> = {}): Place {
  return { id, title: id, resolveStatus: 'resolved', aiTags: [], firstSeenAt: NOW, updatedAt: NOW, ...extra }
}
const lists: List[] = [
  { id: 'v', name: 'Visited', role: 'visited', suggestedRole: 'visited', color: '#000', source: 'csv', createdAt: NOW },
  { id: 'w', name: 'Want to go', role: 'wantToGo', suggestedRole: 'wantToGo', color: '#000', source: 'csv', createdAt: NOW },
]

describe('buildViews', () => {
  it('derives visited and want-to-go from list roles and local visits', () => {
    const places = [place('a'), place('b'), place('c'), place('gone')]
    const ms: Membership[] = [
      { placeId: 'a', listId: 'v', addedAt: NOW },
      { placeId: 'b', listId: 'w', addedAt: NOW, googleTags: 'Date night, ❤️' },
      { placeId: 'c', listId: 'w', addedAt: NOW },
      { placeId: 'gone', listId: 'w', addedAt: NOW, removedAt: NOW },
    ]
    const views = buildViews({ places, memberships: ms, lists, userData: [{ placeId: 'c', userTags: [], visits: [{ date: NOW }] }] })
    const by = Object.fromEntries(views.map((v) => [v.id, v]))
    expect(by.a).toMatchObject({ visited: true, wantToGo: false })
    expect(by.b).toMatchObject({ visited: false, wantToGo: true, tags: ['date night', '❤️'] })
    expect(by.c).toMatchObject({ visited: true, wantToGo: false })
    expect(by.gone).toBeUndefined()
  })
})

describe('applyFilters', () => {
  const places = [
    place('cafe-ist', { category: 'cafe', city: 'Istanbul', country: 'Türkiye', lat: 41, lng: 29 }),
    place('food-ist', { category: 'food', city: 'Istanbul', country: 'Türkiye', lat: 41.01, lng: 29.01 }),
    place('cafe-lis', { category: 'cafe', city: 'Lisbon', country: 'Portugal', lat: 38.7, lng: -9.1 }),
  ]
  const ms: Membership[] = [
    { placeId: 'cafe-ist', listId: 'v', addedAt: NOW, note: 'great' },
    { placeId: 'food-ist', listId: 'w', addedAt: NOW },
    { placeId: 'cafe-lis', listId: 'w', addedAt: NOW },
  ]
  const views = buildViews({ places, memberships: ms, lists, userData: [] })
  const f = (patch: Partial<Filters>) => ({ ...emptyFilters(), ...patch })

  it('ORs within a group and ANDs across groups', () => {
    expect(applyFilters(views, f({ categories: ['cafe', 'food'] })).items).toHaveLength(3)
    expect(applyFilters(views, f({ categories: ['cafe'], cities: ['Istanbul'] })).items.map((v) => v.id)).toEqual(['cafe-ist'])
  })

  it('counts each facet with the other groups applied', () => {
    const { counts } = applyFilters(views, f({ categories: ['cafe'] }))
    // Category counts ignore the category selection itself...
    expect(counts.categories.get('food')).toBe(1)
    expect(counts.categories.get('cafe')).toBe(2)
    // ...while other facets reflect it.
    expect(counts.cities.get('Istanbul')).toBe(1)
    expect(counts.status.get('wantToGo')).toBe(1)
  })

  it('filters by status, notes, viewport and radius', () => {
    expect(applyFilters(views, f({ status: ['wantToGo'] })).items).toHaveLength(2)
    expect(applyFilters(views, f({ hasNotes: true })).items.map((v) => v.id)).toEqual(['cafe-ist'])
    expect(applyFilters(views, f({ bbox: [28, 40, 30, 42] })).items).toHaveLength(2)
    expect(applyFilters(views, f({ near: { lat: 41, lng: 29, km: 0.5 } })).items.map((v) => v.id)).toEqual(['cafe-ist'])
  })

  it('round-trips through the URL', () => {
    const filters = f({ q: 'kahve', categories: ['cafe', 'bar'], status: ['visited'], hasNotes: true, bbox: [1, 2, 3, 4], seenFrom: '2026-01-01' })
    expect(decodeFilters(encodeFilters(filters))).toEqual(filters)
    expect(activeFilterCount(filters)).toBe(7)
    expect(encodeFilters(emptyFilters())).toBe('')
  })
})

describe('search and spatial index', () => {
  const data = buildDemoData(300, 1, NOW)
  const views = buildViews({ ...data, userData: [] })

  it('finds places by fuzzy title, category and area, ignoring diacritics', () => {
    const index = createIndex(toSearchDocs(views))
    const target = views.find((v) => v.place.neighborhood === 'Kadıköy')!
    expect(search(index, 'kadikoy').has(target.id)).toBe(true)
    expect(search(index, target.place.title.slice(0, -1)).has(target.id)).toBe(true)
    expect(search(index, '').size).toBe(0)
  })

  it('orders by distance', () => {
    const spatial = new SpatialIndex(views)
    const near = spatial.nearest(40.99, 29.03, 5)
    expect(near).toHaveLength(5)
    expect(views.find((v) => v.id === near[0])!.place.city).toBe('Istanbul')
  })
})

describe('performance budget at 10,000 places', () => {
  it('filters and searches within budget', () => {
    const data = buildDemoData(10_000, 3, NOW)
    const views = buildViews({ ...data, userData: [] })
    const index = createIndex(toSearchDocs(views))

    let t = performance.now()
    applyFilters(views, { ...emptyFilters(), categories: ['cafe', 'food'], status: ['wantToGo'] })
    const filterMs = performance.now() - t

    t = performance.now()
    const hits = search(index, 'coffee kad')
    const searchMs = performance.now() - t

    t = performance.now()
    new SpatialIndex(views).nearest(41, 29, 50)
    const spatialMs = performance.now() - t

    expect(hits.size).toBeGreaterThan(0)
    // Desktop CI numbers; the phone targets are 100 / 30 / 50 ms.
    expect(filterMs).toBeLessThan(50)
    expect(searchMs).toBeLessThan(30)
    expect(spatialMs).toBeLessThan(50)
  })
})

describe('open now', () => {
  const views = buildViews({
    places: [
      place('day', { openingHours: 'Mo-Fr 09:00-17:00' }),
      place('night', { openingHours: 'Mo-Su 18:00-02:00' }),
      place('odd', { openingHours: 'sunrise-sunset' }),
      place('none'),
    ],
    memberships: ['day', 'night', 'odd', 'none'].map((placeId) => ({ placeId, listId: 'w', addedAt: NOW })),
    lists,
    userData: [],
  })

  it('keeps only places known to be open at that moment', () => {
    const f = { ...emptyFilters(), openNow: true }
    const mondayNoon = new Date(2026, 9, 12, 12, 0)
    const tuesdayOneAm = new Date(2026, 9, 13, 1, 0)
    expect(applyFilters(views, f, null, mondayNoon).items.map((v) => v.id)).toEqual(['day'])
    expect(applyFilters(views, f, null, tuesdayOneAm).items.map((v) => v.id)).toEqual(['night'])
  })

  it('round-trips through the URL and counts as a filter', () => {
    const f = { ...emptyFilters(), openNow: true }
    expect(encodeFilters(f)).toBe('open=1')
    expect(decodeFilters('open=1').openNow).toBe(true)
    expect(activeFilterCount(f)).toBe(1)
  })
})
