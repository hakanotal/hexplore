import { describe, expect, it } from 'vitest'
import type { List, Membership, Place, UserData } from '../domain/types'
import { computeStats } from './compute'

const T0 = Date.UTC(2026, 9, 10, 12)
const T1 = Date.UTC(2026, 10, 20, 12)
const NOW = Date.UTC(2027, 0, 5, 12)

const place = (id: string, over: Partial<Place> = {}): Place => ({ id, title: id, resolveStatus: 'resolved', aiTags: [], firstSeenAt: T0, updatedAt: T0, lat: 1, lng: 1, ...over })
const m = (placeId: string, listId: string, removedAt?: number): Membership => ({ placeId, listId, addedAt: T0, removedAt })
const lists: List[] = [
  { id: 'visited', name: 'Visited', role: 'visited', suggestedRole: 'visited', color: '#000', source: 'csv', createdAt: T0 },
  { id: 'want', name: 'Want to go', role: 'wantToGo', suggestedRole: 'wantToGo', color: '#000', source: 'csv', createdAt: T0 },
  { id: 'fav', name: 'Favorites', role: 'favorite', suggestedRole: 'favorite', color: '#000', source: 'csv', createdAt: T0 },
]

function input() {
  const places = [
    place('galata', { country: 'Türkiye', countryCode: 'TR', city: 'Istanbul', neighborhood: 'Beyoğlu', category: 'landmark', aiTags: ['view'] }),
    place('pandeli', { country: 'Türkiye', countryCode: 'TR', city: 'Istanbul', neighborhood: 'Fatih', category: 'food', googleTypes: ['turkish_restaurant', 'restaurant'] }),
    place('moda', { country: 'Türkiye', countryCode: 'TR', city: 'Istanbul', neighborhood: 'Kadıköy', category: 'cafe' }),
    place('bingo', { country: 'Bosnia and Herzegovina', countryCode: 'BA', city: 'Sarajevo', category: 'shopping', firstSeenAt: T1 }),
    place('gone', { country: 'Canada', city: 'Montreal' }),
  ]
  const memberships = [m('galata', 'visited'), m('galata', 'fav'), m('pandeli', 'want', T1), m('pandeli', 'visited'), m('moda', 'want'), m('bingo', 'want'), m('gone', 'want', T1)]
  const userData: UserData[] = [{ placeId: 'moda', userTags: [], visits: [{ date: Date.UTC(2026, 11, 3) }] }]
  return { places, memberships, lists, userData, imports: [{ date: T0, fileHashes: {}, counts: {} as never, warnings: [] }] }
}

describe('computeStats', () => {
  const s = computeStats(input(), NOW)

  it('counts totals over the places on the map', () => {
    // "gone" left every list, so it is off the map; moda counts as visited through its logged visit.
    expect(s.totals).toMatchObject({ saved: 4, visited: 3, wantToGo: 1, favorites: 1, countries: 2, visitedCountries: 1, cities: 2, visitedCities: 1, neighborhoods: 3, visitedNeighborhoods: 3 })
  })

  it('ranks countries and cities with neighborhood coverage', () => {
    expect(s.countries[0]).toMatchObject({ key: 'Türkiye', code: 'TR', saved: 3, visited: 3 })
    expect(s.cities.find((c) => c.key === 'Istanbul')).toMatchObject({ country: 'Türkiye', neighborhoods: 3, visitedNeighborhoods: 3 })
    expect(s.cities.find((c) => c.key === 'Sarajevo')).toMatchObject({ neighborhoods: 0, wantToGo: 1 })
  })

  it('breaks down taste by category, tag and cuisine', () => {
    expect(s.categories.map((c) => c.label)).toEqual(['Cafe', 'Food', 'Landmark', 'Shopping'])
    expect(s.tags).toEqual([{ key: 'view', label: 'view', saved: 1, visited: 1, wantToGo: 0 }])
    expect(s.cuisines).toEqual([{ key: 'turkish', label: 'Turkish', saved: 1, visited: 1, wantToGo: 0 }])
  })

  it('measures the backlog and how much of it got visited', () => {
    expect(s.backlog.wantByCity.map((r) => [r.key, r.wantToGo])).toEqual([['Sarajevo', 1]])
    expect(s.backlog.oldest.map((o) => o.id)).toEqual(['bingo'])
    // pandeli moved from Want to go to Visited; moda was visited while still listed; bingo is waiting.
    expect(s.backlog.conversion).toMatchObject({ wanted: 3, visited: 2 })
    expect(s.backlog.conversionByCity.find((c) => c.key === 'Istanbul')).toMatchObject({ wanted: 2, visited: 2 })
  })

  it('puts first-import places before tracking and counts later ones by month', () => {
    expect(s.growth.beforeTracking).toBe(3)
    expect(s.growth.months).toEqual([
      { month: '2026-10', added: 0, visits: 0 },
      { month: '2026-11', added: 1, visits: 0 },
      { month: '2026-12', added: 0, visits: 1 },
      { month: '2027-01', added: 0, visits: 0 },
    ])
  })
})
