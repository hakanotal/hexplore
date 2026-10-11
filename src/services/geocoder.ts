// Common shape for OSM-based geocoders. Every provider normalizes into
// GeoCandidate so resolution, review and the assistant never see provider JSON.

export interface GeoCandidate {
  name: string
  lat: number
  lng: number
  /** e.g. node/123456 */
  osmId?: string
  osmTags: Record<string, string>
  address?: string
  neighborhood?: string
  city?: string
  region?: string
  country?: string
  countryCode?: string
  source: string
}

export interface GeocodeQuery {
  text: string
  /** Bias results toward this point (list cluster center). */
  near?: { lat: number; lng: number }
  limit?: number
  lang?: string
}

export interface Geocoder {
  readonly id: string
  search(query: GeocodeQuery, signal?: AbortSignal): Promise<GeoCandidate[]>
}

export interface ReverseGeocoder {
  readonly id: string
  reverse(point: { lat: number; lng: number }, signal?: AbortSignal): Promise<GeoCandidate | null>
}

export type GeocoderId = 'photon' | 'nominatim' | 'fixture'
