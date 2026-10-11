import type { GeoCandidate, GeocodeQuery, Geocoder, ReverseGeocoder } from '../services/geocoder'
import { parsePhotonResponse, type PhotonFeature } from '../services/photon'
import { haversineKm, nameSimilarity, normalizeName } from '../pipeline/similarity'
import { CITIES, createRng, generateWorld, type WorldPlace } from './world'

// Offline stand-in for Photon and Nominatim, backed by the synthetic world. It
// answers in Photon's JSON format and goes through the real parser, so the
// resolution pipeline runs unchanged. Some places get a same-named decoy in
// another city so disambiguation and list-context biasing have work to do.

function toFeature(p: WorldPlace, overrides: Partial<WorldPlace> = {}): PhotonFeature {
  const q = { ...p, ...overrides }
  const [key, value] = Object.entries(q.osmTags).find(([k]) => k !== 'name' && k !== 'opening_hours' && k !== 'website') ?? []
  return {
    geometry: { coordinates: [q.lng, q.lat] },
    properties: {
      osm_id: Number(q.osmId.split('/')[1]),
      osm_type: 'N',
      osm_key: key,
      osm_value: value,
      name: q.title,
      street: q.street,
      housenumber: q.houseNumber,
      district: q.neighborhood,
      city: q.city,
      state: q.region,
      country: q.country,
      countrycode: q.countryCode,
    },
  }
}

function decoyFor(p: WorldPlace): WorldPlace | null {
  if (p.chain || p.index % 6 !== 0) return null
  const rng = createRng(p.index + 991)
  const others = CITIES.filter((c) => c.name !== p.city)
  const city = rng.pick(others)
  const hood = rng.pick(city.neighborhoods)
  return {
    ...p,
    osmId: `node/${900000000 + p.index}`,
    lat: hood.lat + (rng.next() - 0.5) * 0.01,
    lng: hood.lng + (rng.next() - 0.5) * 0.01,
    city: city.name,
    neighborhood: hood.name,
    region: city.region,
    country: city.country,
    countryCode: city.countryCode,
    street: rng.pick(city.streets),
  }
}

export class FixtureGeocoder implements Geocoder, ReverseGeocoder {
  readonly id = 'fixture'
  private readonly entries: { place: WorldPlace; norm: string }[]
  private readonly delayMs: number

  constructor(world: WorldPlace[] = generateWorld(2000), delayMs = 0) {
    this.delayMs = delayMs
    this.entries = []
    for (const place of world) {
      this.entries.push({ place, norm: normalizeName(place.title) })
      const decoy = decoyFor(place)
      if (decoy) this.entries.push({ place: decoy, norm: normalizeName(decoy.title) })
    }
  }

  private async wait() {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs))
  }

  async search(q: GeocodeQuery): Promise<GeoCandidate[]> {
    await this.wait()
    const scored = this.entries
      .map((e) => ({ e, sim: nameSimilarity(q.text, e.place.title) }))
      .filter((x) => x.sim >= 0.55)
      .map((x) => {
        // Mimic location bias: closer candidates rank higher, never filtered out.
        const near = q.near ? Math.exp(-haversineKm(q.near, x.e.place) / 50) : 0
        return { ...x, rank: x.sim + near * 0.5 }
      })
      .sort((a, b) => b.rank - a.rank)
      .slice(0, q.limit ?? 5)
    return parsePhotonResponse({ features: scored.map((x) => toFeature(x.e.place)) }, this.id)
  }

  async reverse(point: { lat: number; lng: number }): Promise<GeoCandidate | null> {
    await this.wait()
    let best: WorldPlace | undefined
    let bestKm = Infinity
    for (const { place } of this.entries) {
      const d = haversineKm(point, place)
      if (d < bestKm) {
        bestKm = d
        best = place
      }
    }
    if (best && bestKm < 0.04) return parsePhotonResponse({ features: [toFeature(best)] }, this.id)[0] ?? null

    // No POI under the point: answer with the nearest neighborhood, address only.
    let hood: { city: (typeof CITIES)[number]; name: string; lat: number; lng: number } | undefined
    let hoodKm = Infinity
    for (const city of CITIES) {
      for (const n of city.neighborhoods) {
        const d = haversineKm(point, n)
        if (d < hoodKm) {
          hoodKm = d
          hood = { city, ...n }
        }
      }
    }
    if (!hood || hoodKm > 30) return null
    return {
      name: hood.name,
      lat: point.lat,
      lng: point.lng,
      osmTags: {},
      address: `${hood.name}, ${hood.city.name}, ${hood.city.country}`,
      neighborhood: hood.name,
      city: hood.city.name,
      region: hood.city.region,
      country: hood.city.country,
      countryCode: hood.city.countryCode,
      source: this.id,
    }
  }
}
