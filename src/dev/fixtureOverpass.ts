import type { OsmPoi, PoiFinder } from '../services/overpass'
import { haversineKm } from '../pipeline/similarity'
import type { WorldPlace } from './world'

// Offline stand-in for Overpass, backed by the synthetic world: every world
// place is an OSM feature with its tags (opening hours and website for some).

export class FixtureOverpass implements PoiFinder {
  readonly id = 'fixture'
  calls = 0
  private readonly pois: OsmPoi[]

  constructor(world: WorldPlace[]) {
    this.pois = world.map((w) => ({ osmId: w.osmId, lat: w.lat, lng: w.lng, tags: w.osmTags }))
  }

  async poisNear(points: { lat: number; lng: number }[], radiusM: number): Promise<OsmPoi[]> {
    this.calls++
    return this.pois.filter((poi) => points.some((p) => haversineKm(p, poi) * 1000 <= radiusM))
  }
}
