import type { Place } from '../domain/types'
import { classifyByOsmTags } from '../domain/taxonomy'
import type { ReverseGeocoder } from '../services/geocoder'
import { nameSimilarity } from './similarity'

// Stage 4 (area) and the rule half of stage 3 (classify). Overpass matching
// (stage 2), LLM classification and embeddings (stage 5) plug in beside these.

/** Reverse geocodes places that came with coordinates but no area. */
export async function assignArea(place: Place, reverse: ReverseGeocoder, signal?: AbortSignal): Promise<Partial<Place>> {
  if (place.lat === undefined || place.lng === undefined) return {}
  const hit = await reverse.reverse({ lat: place.lat, lng: place.lng }, signal)
  if (!hit) return {}
  const patch: Partial<Place> = {
    address: place.address ?? hit.address,
    neighborhood: hit.neighborhood,
    city: hit.city,
    region: hit.region,
    country: hit.country,
    countryCode: hit.countryCode ?? place.countryCode,
  }
  // At zoom 18 the reverse hit is often the POI itself; keep its tags if the name agrees.
  if (!place.osmTags && Object.keys(hit.osmTags).length > 1 && nameSimilarity(place.title, hit.name) >= 0.7) {
    patch.osmId = hit.osmId
    patch.osmTags = hit.osmTags
  }
  return patch
}

export interface ClassifyResult {
  patch: Partial<Place>
  /** True when rules could not decide and the LLM classifier should take it. */
  needsModel: boolean
}

export function classifyPlace(place: Place): ClassifyResult {
  const tags = place.osmTags
  const patch: Partial<Place> = {}
  if (tags?.opening_hours && !place.openingHours) patch.openingHours = tags.opening_hours
  if (tags?.website && !place.website) patch.website = tags.website
  const rule = classifyByOsmTags(tags)
  if (rule) {
    patch.category = rule.category
    patch.subcategory = rule.subcategory
  }
  return { patch, needsModel: !rule }
}
