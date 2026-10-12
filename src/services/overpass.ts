import { hashString } from '../import/googleUrl'
import { cached, fetchJson, RateLimiter } from './http'

// Overpass returns OSM features with all their tags: opening hours, website,
// cuisine, wheelchair access. One query per area cluster unions a small
// "around" search per place; a list of coordinates in one around() would be
// read as a line, not as separate points.

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

export interface OsmPoi {
  /** e.g. node/123456 */
  osmId: string
  lat: number
  lng: number
  tags: Record<string, string>
}

export interface PoiFinder {
  readonly id: string
  /** Named OSM features within `radiusM` of any of the points. */
  poisNear(points: { lat: number; lng: number }[], radiusM: number, signal?: AbortSignal): Promise<OsmPoi[]>
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

export function parseOverpass(json: { elements?: OverpassElement[] }): OsmPoi[] {
  const out: OsmPoi[] = []
  for (const e of json.elements ?? []) {
    const lat = e.lat ?? e.center?.lat
    const lng = e.lon ?? e.center?.lon
    if (lat === undefined || lng === undefined || !e.tags?.name) continue
    out.push({ osmId: `${e.type}/${e.id}`, lat, lng, tags: e.tags })
  }
  return out
}

export function overpassQuery(points: { lat: number; lng: number }[], radiusM: number): string {
  const parts = points.map((p) => `nwr(around:${Math.round(radiusM)},${p.lat.toFixed(6)},${p.lng.toFixed(6)})[name];`)
  return `[out:json][timeout:60];(${parts.join('')});out center tags;`
}

// The public instance allows a couple of parallel slots per IP; stay well under.
const limiter = new RateLimiter(1500)

export class OverpassClient implements PoiFinder {
  readonly id = 'overpass'
  private readonly url: string

  constructor(url = OVERPASS_URL) {
    this.url = url
  }

  async poisNear(points: { lat: number; lng: number }[], radiusM: number, signal?: AbortSignal): Promise<OsmPoi[]> {
    if (!points.length) return []
    const query = overpassQuery(points, radiusM)
    // OSM data may be stored permanently.
    const json = await cached(`overpass:${hashString(query)}`, () =>
      limiter.schedule(() =>
        fetchJson<{ elements?: OverpassElement[] }>(this.url, {
          method: 'POST',
          body: new URLSearchParams({ data: query }).toString(),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal,
          backoffMs: 4000,
        }),
      ),
    )
    return parseOverpass(json)
  }
}
