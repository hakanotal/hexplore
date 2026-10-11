import type { GeoCandidate, GeocodeQuery, Geocoder, ReverseGeocoder } from './geocoder'
import { cached, fetchJson, RateLimiter } from './http'

// Nominatim's usage policy allows at most 1 request per second and requires
// caching. Browsers cannot set User-Agent, so the Referer identifies the app.

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org'

export interface NominatimPlace {
  osm_type?: 'node' | 'way' | 'relation'
  osm_id?: number
  lat: string
  lon: string
  category?: string
  type?: string
  name?: string
  display_name?: string
  address?: Record<string, string>
  extratags?: Record<string, string> | null
}

/** Neighborhood naming varies by country, so fall through the common keys. */
export function pickNeighborhood(a: Record<string, string>): string | undefined {
  return a.neighbourhood ?? a.suburb ?? a.quarter ?? a.city_district ?? a.borough
}

export function pickCity(a: Record<string, string>): string | undefined {
  return a.city ?? a.town ?? a.village ?? a.municipality ?? a.county
}

export function parseNominatimPlace(p: NominatimPlace, source = 'nominatim'): GeoCandidate {
  const a = p.address ?? {}
  const tags: Record<string, string> = { ...(p.extratags ?? {}) }
  if (p.category && p.type) tags[p.category] = p.type
  if (p.name) tags.name = p.name
  const street = [a.road, a.house_number].filter(Boolean).join(' ')
  return {
    name: p.name || p.display_name?.split(',')[0] || 'Unnamed',
    lat: Number(p.lat),
    lng: Number(p.lon),
    osmId: p.osm_type && p.osm_id ? `${p.osm_type}/${p.osm_id}` : undefined,
    osmTags: tags,
    address: [street, pickNeighborhood(a), pickCity(a), a.country].filter(Boolean).join(', ') || p.display_name,
    neighborhood: pickNeighborhood(a),
    city: pickCity(a),
    region: a.state ?? a.province ?? a.region,
    country: a.country,
    countryCode: a.country_code?.toUpperCase(),
    source,
  }
}

const limiter = new RateLimiter(1100)

export class NominatimGeocoder implements Geocoder, ReverseGeocoder {
  readonly id = 'nominatim'
  private readonly baseUrl: string

  constructor(baseUrl = NOMINATIM_URL) {
    this.baseUrl = baseUrl
  }

  async search(q: GeocodeQuery, signal?: AbortSignal): Promise<GeoCandidate[]> {
    const params = new URLSearchParams({
      q: q.text,
      format: 'jsonv2',
      addressdetails: '1',
      extratags: '1',
      limit: String(q.limit ?? 5),
    })
    if (q.near) {
      // ~20 km box, not bounded, so it biases rather than restricts
      const d = 0.2
      params.set('viewbox', [q.near.lng - d, q.near.lat + d, q.near.lng + d, q.near.lat - d].map((x) => x.toFixed(4)).join(','))
    }
    if (q.lang) params.set('accept-language', q.lang)
    const url = `${this.baseUrl}/search?${params}`
    const json = await cached(`nominatim:${url}`, () => limiter.schedule(() => fetchJson<NominatimPlace[]>(url, { signal })))
    return json.map((p) => parseNominatimPlace(p))
  }

  async reverse(point: { lat: number; lng: number }, signal?: AbortSignal): Promise<GeoCandidate | null> {
    const params = new URLSearchParams({
      lat: point.lat.toFixed(6),
      lon: point.lng.toFixed(6),
      format: 'jsonv2',
      addressdetails: '1',
      extratags: '1',
      zoom: '18',
    })
    const url = `${this.baseUrl}/reverse?${params}`
    const json = await cached(`nominatim:${url}`, () =>
      limiter.schedule(() => fetchJson<NominatimPlace & { error?: string }>(url, { signal })),
    )
    if (json.error) return null
    return parseNominatimPlace(json)
  }
}
