import { safeHttpUrl } from '../domain/safeUrl'
import type { Place } from '../domain/types'
import type { OsmPoi } from '../services/overpass'
import { haversineKm, nameSimilarity } from './similarity'

// Stage 2: attach the OSM feature behind a located place, for its tags
// (opening hours, website, cuisine, wheelchair). Google's points and OSM's
// can sit tens of metres apart, so the search radius is generous and the
// name decides.

export const MATCH_RADIUS_M = 80
const MIN_NAME = 0.6

const NAME_KEYS = ['name', 'name:en', 'int_name', 'alt_name', 'old_name', 'official_name', 'short_name']

export function bestPoi(place: Pick<Place, 'title' | 'lat' | 'lng'>, pois: OsmPoi[]): OsmPoi | null {
  if (place.lat === undefined || place.lng === undefined) return null
  let best: OsmPoi | null = null
  let bestScore = 0
  for (const poi of pois) {
    const meters = haversineKm({ lat: place.lat, lng: place.lng }, poi) * 1000
    if (meters > MATCH_RADIUS_M) continue
    let name = 0
    for (const k of NAME_KEYS) {
      // Names in other languages too (name:tr, name:fr): lists may be saved in any of them.
      const v = poi.tags[k]
      if (v) name = Math.max(name, nameSimilarity(place.title, v))
    }
    for (const [k, v] of Object.entries(poi.tags)) if (k.startsWith('name:')) name = Math.max(name, nameSimilarity(place.title, v))
    if (name < MIN_NAME) continue
    // Name first; distance only breaks near-ties.
    const score = name - meters / (MATCH_RADIUS_M * 10)
    if (score > bestScore) {
      bestScore = score
      best = poi
    }
  }
  return best
}

export function matchPatch(poi: OsmPoi): Partial<Place> {
  const t = poi.tags
  return {
    osmId: poi.osmId,
    osmTags: t,
    openingHours: t.opening_hours,
    // OSM tags are user-edited data; only web links survive.
    website: safeHttpUrl(t.website ?? t['contact:website']),
  }
}
