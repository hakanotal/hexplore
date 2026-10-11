import type { List, Membership, Place } from '../domain/types'
import { createRng, generateWorld } from './world'

// Fully enriched synthetic records, written straight to the database. Used for
// UI work and the 10,000-place performance budget; the sample Takeout is the
// way to exercise import and resolution instead.

export interface DemoData {
  places: Place[]
  lists: List[]
  memberships: Membership[]
}

export function buildDemoData(count: number, seed = 7, now = Date.now()): DemoData {
  const world = generateWorld(count, seed)
  const rng = createRng(seed)
  const lists: List[] = [
    { id: 'demo-visited', name: 'Visited', role: 'visited', suggestedRole: 'visited', color: '#3a9d23', source: 'csv', createdAt: now },
    { id: 'demo-want', name: 'Want to go', role: 'wantToGo', suggestedRole: 'wantToGo', color: '#e4572e', source: 'csv', createdAt: now },
    { id: 'demo-fav', name: 'Favorite places', role: 'favorite', suggestedRole: 'favorite', color: '#c9a227', source: 'csv', createdAt: now },
    { id: 'demo-coffee', name: 'Coffee ☕', role: 'other', suggestedRole: 'other', color: '#a0522d', source: 'csv', createdAt: now },
  ]
  const twoYears = 730 * 86_400_000
  const places: Place[] = []
  const memberships: Membership[] = []
  for (const w of world) {
    const firstSeenAt = now - Math.floor(rng.next() ** 2 * twoYears)
    places.push({
      id: `g${w.cid}`,
      googleFid: w.fid,
      googleCid: w.cid,
      googleUrl: `https://www.google.com/maps/place/${encodeURIComponent(w.title)}/data=!4m2!3m1!1s${w.fid}`,
      title: w.title,
      lat: w.lat,
      lng: w.lng,
      coordSource: 'geocoder',
      resolveStatus: rng.chance(0.03) ? 'flagged' : 'resolved',
      resolveConfidence: 0.9,
      resolveSource: 'fixture',
      osmId: w.osmId,
      osmTags: w.osmTags,
      address: w.address,
      countryCode: w.countryCode,
      country: w.country,
      region: w.region,
      city: w.city,
      neighborhood: w.neighborhood,
      category: w.category,
      subcategory: w.subcategory,
      aiTags: w.tags,
      priceLevel: w.priceLevel,
      openingHours: w.osmTags.opening_hours,
      website: w.osmTags.website,
      firstSeenAt,
      updatedAt: now,
    })
    const id = `g${w.cid}`
    const visited = rng.chance(0.4)
    memberships.push({ placeId: id, listId: visited ? 'demo-visited' : 'demo-want', addedAt: firstSeenAt, note: rng.chance(0.15) ? 'Recommended by a friend' : undefined })
    if (visited && rng.chance(0.25)) memberships.push({ placeId: id, listId: 'demo-fav', addedAt: firstSeenAt })
    if (w.category === 'cafe' && rng.chance(0.5)) memberships.push({ placeId: id, listId: 'demo-coffee', addedAt: firstSeenAt })
  }
  return { places, lists, memberships }
}
