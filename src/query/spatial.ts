import KDBush from 'kdbush'
import { around } from 'geokdbush'
import type { PlaceView } from './placeView'

/** kdbush index over located places for near-me sorting and radius queries. */
export class SpatialIndex {
  private readonly index: KDBush
  private readonly ids: string[]

  constructor(views: PlaceView[]) {
    const located = views.filter((v) => v.lat !== undefined && v.lng !== undefined)
    this.ids = located.map((v) => v.id)
    this.index = new KDBush(Math.max(1, located.length))
    for (const v of located) this.index.add(v.lng!, v.lat!)
    if (!located.length) this.index.add(0, 0)
    this.index.finish()
  }

  /** Ids ordered by distance, optionally limited by count and radius (km). */
  nearest(lat: number, lng: number, maxResults = Infinity, maxKm = Infinity): string[] {
    if (!this.ids.length) return []
    return around(this.index, lng, lat, maxResults, maxKm).map((i) => this.ids[i]!)
  }
}
