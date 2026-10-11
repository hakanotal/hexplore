// Parses "Saved Places.json" (GeoJSON) from the Maps (your places) Takeout product.
// Two property layouts exist in the wild; both are handled.

export interface StarredPlace {
  title: string
  url?: string
  address?: string
  countryCode?: string
  comment?: string
  lat?: number
  lng?: number
  savedAt?: number
}

export interface ParsedStarred {
  places: StarredPlace[]
  warnings: string[]
}

type Json = Record<string, unknown>

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function obj(v: unknown): Json | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined
}

function parseDate(v: unknown): number | undefined {
  const s = str(v)
  if (!s) return undefined
  const t = Date.parse(s)
  return Number.isNaN(t) ? undefined : t
}

export function isFeatureCollection(json: unknown): json is { type: 'FeatureCollection'; features: unknown[] } {
  const o = obj(json)
  return !!o && o.type === 'FeatureCollection' && Array.isArray(o.features)
}

/** Reviews.json shares the GeoJSON shape; tell them apart by review fields. */
export function looksLikeReviews(json: { features: unknown[] }): boolean {
  const first = obj(obj(json.features[0])?.properties)
  return !!first && ('five_star_rating_published' in first || 'review_text_published' in first)
}

export function parseStarred(json: unknown): ParsedStarred {
  const warnings: string[] = []
  if (!isFeatureCollection(json)) return { places: [], warnings: ['Not a GeoJSON FeatureCollection'] }

  const places: StarredPlace[] = []
  json.features.forEach((f, i) => {
    const feature = obj(f)
    const props = obj(feature?.properties) ?? {}
    const location = obj(props.location) ?? obj(props.Location) ?? {}
    const geo = obj(location['Geo Coordinates'])

    let lat: number | undefined
    let lng: number | undefined
    const coords = obj(feature?.geometry)?.coordinates
    if (Array.isArray(coords) && coords.length >= 2) {
      lng = Number(coords[0])
      lat = Number(coords[1])
    } else if (geo) {
      lat = Number(geo.Latitude)
      lng = Number(geo.Longitude)
    }
    // Google writes [0, 0] when it has no position for the place.
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
      lat = undefined
      lng = undefined
    }

    const url = str(props.google_maps_url) ?? str(props['Google Maps URL'])
    const address = str(location.address) ?? str(location.Address)
    const title = str(location.name) ?? str(location['Business Name']) ?? str(props.Title) ?? address

    if (!title && !url) {
      warnings.push(`Feature ${i + 1}: no name or URL, skipped`)
      return
    }

    places.push({
      title: title ?? 'Dropped pin',
      url,
      address,
      countryCode: str(location.country_code) ?? str(location['Country Code']),
      comment: str(props.Comment) ?? str(props.comment),
      lat,
      lng,
      savedAt: parseDate(props.date) ?? parseDate(props.Published) ?? parseDate(props.Updated),
    })
  })
  return { places, warnings }
}
