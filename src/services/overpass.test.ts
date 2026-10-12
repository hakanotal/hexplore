import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { freshDb } from '../test/db'
import { OverpassClient, overpassQuery, parseOverpass } from './overpass'

// Recorded shape of an Overpass response; CI never calls the live service.
const body = {
  elements: [
    { type: 'node', id: 1, lat: 41.0256, lon: 28.9741, tags: { name: 'Galata Kulesi', 'name:en': 'Galata Tower', tourism: 'attraction', opening_hours: 'Mo-Su 08:30-23:00' } },
    { type: 'way', id: 2, center: { lat: 41.0255, lon: 28.9745 }, tags: { name: 'Galata Meydanı', place: 'square' } },
    { type: 'node', id: 3, lat: 41.0257, lon: 28.9742, tags: { amenity: 'bench' } },
  ],
}

let calls: string[] = []
const server = setupServer(
  http.post('https://overpass-api.de/api/interpreter', async ({ request }) => {
    calls.push(new URLSearchParams(await request.text()).get('data') ?? '')
    return HttpResponse.json(body)
  }),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
beforeEach(() => {
  freshDb()
  calls = []
})

describe('overpass', () => {
  it('unions one around search per place, since a coordinate list would mean a line', () => {
    const q = overpassQuery([{ lat: 41.0256, lng: 28.9742 }, { lat: 41.03, lng: 28.98 }], 80)
    expect(q).toBe('[out:json][timeout:60];(nwr(around:80,41.025600,28.974200)[name];nwr(around:80,41.030000,28.980000)[name];);out center tags;')
  })

  it('keeps named features, using the center of ways', () => {
    expect(parseOverpass(body as never).map((p) => [p.osmId, p.lat])).toEqual([
      ['node/1', 41.0256],
      ['way/2', 41.0255],
    ])
  })

  it('posts the query and caches the answer', async () => {
    const client = new OverpassClient()
    const points = [{ lat: 41.0256, lng: 28.9742 }]
    expect(await client.poisNear(points, 80)).toHaveLength(2)
    await client.poisNear(points, 80)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('around:80,41.025600,28.974200')
  })
})
