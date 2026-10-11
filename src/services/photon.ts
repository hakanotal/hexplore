import type { GeoCandidate, GeocodeQuery, Geocoder } from './geocoder'
import { cached, fetchJson, RateLimiter } from './http'

// Photon (komoot) is good at fuzzy POI names and returns OSM key/value, which
// feeds rule-based classification directly.

export const PHOTON_URL = 'https://photon.komoot.io'

export interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: {
    osm_id?: number
    osm_type?: 'N' | 'W' | 'R'
    osm_key?: string
    osm_value?: string
    name?: string
    housenumber?: string
    street?: string
    postcode?: string
    locality?: string
    district?: string
    city?: string
    county?: string
    state?: string
    country?: string
    countrycode?: string
  }
}

export interface PhotonResponse {
  features: PhotonFeature[]
}

const OSM_TYPE: Record<string, string> = { N: 'node', W: 'way', R: 'relation' }

export function parsePhotonResponse(json: PhotonResponse, source = 'photon'): GeoCandidate[] {
  return (json.features ?? []).flatMap((f) => {
    const p = f.properties ?? {}
    const [lng, lat] = f.geometry?.coordinates ?? []
    if (typeof lat !== 'number' || typeof lng !== 'number') return []
    const street = [p.street, p.housenumber].filter(Boolean).join(' ')
    const tags: Record<string, string> = {}
    if (p.osm_key && p.osm_value) tags[p.osm_key] = p.osm_value
    if (p.name) tags.name = p.name
    return [
      {
        name: p.name || street || 'Unnamed',
        lat,
        lng,
        osmId: p.osm_type && p.osm_id ? `${OSM_TYPE[p.osm_type]}/${p.osm_id}` : undefined,
        osmTags: tags,
        address: [street, p.district ?? p.locality, p.city, p.country].filter(Boolean).join(', ') || undefined,
        neighborhood: p.district ?? p.locality,
        city: p.city ?? p.county,
        region: p.state,
        country: p.country,
        countryCode: p.countrycode?.toUpperCase(),
        source,
      },
    ]
  })
}

export class PhotonGeocoder implements Geocoder {
  readonly id = 'photon'
  // Public instance has no hard limit but asks for fair use.
  private readonly limiter = new RateLimiter(250)
  private readonly baseUrl: string

  constructor(baseUrl = PHOTON_URL) {
    this.baseUrl = baseUrl
  }

  buildUrl(q: GeocodeQuery): string {
    const params = new URLSearchParams({ q: q.text, limit: String(q.limit ?? 5) })
    if (q.near) {
      params.set('lat', q.near.lat.toFixed(4))
      params.set('lon', q.near.lng.toFixed(4))
      params.set('location_bias_scale', '0.5')
    }
    if (q.lang) params.set('lang', q.lang)
    return `${this.baseUrl}/api/?${params}`
  }

  async search(q: GeocodeQuery, signal?: AbortSignal): Promise<GeoCandidate[]> {
    const url = this.buildUrl(q)
    const json = await cached(`photon:${url}`, () => this.limiter.schedule(() => fetchJson<PhotonResponse>(url, { signal })))
    return parsePhotonResponse(json)
  }
}
