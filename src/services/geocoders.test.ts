import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { freshDb } from '../test/db'
import { PhotonGeocoder } from './photon'
import { NominatimGeocoder } from './nominatim'
import { fetchJson, HttpError } from './http'

// Recorded-shape responses; CI never calls the live services.
const photonBody = {
  features: [
    {
      geometry: { coordinates: [29.0257, 40.9812] },
      properties: { osm_id: 123, osm_type: 'N', osm_key: 'amenity', osm_value: 'cafe', name: 'Kronotrop', street: 'Moda Caddesi', housenumber: '12', district: 'Moda', city: 'Istanbul', state: 'Istanbul', country: 'Türkiye', countrycode: 'tr' },
    },
  ],
}
const nominatimReverse = {
  osm_type: 'node',
  osm_id: 456,
  lat: '38.7118',
  lon: '-9.13',
  category: 'tourism',
  type: 'viewpoint',
  name: 'Miradouro de Santa Luzia',
  address: { suburb: 'Alfama', city: 'Lisboa', state: 'Lisboa', country: 'Portugal', country_code: 'pt' },
  extratags: { opening_hours: '24/7' },
}

let photonCalls = 0
let flaky = 0
const server = setupServer(
  http.get('https://photon.komoot.io/api/', ({ request }) => {
    photonCalls++
    const url = new URL(request.url)
    expect(url.searchParams.get('q')).toBe('Kronotrop')
    return HttpResponse.json(photonBody)
  }),
  http.get('https://nominatim.openstreetmap.org/reverse', () => HttpResponse.json(nominatimReverse)),
  http.get('https://example.test/flaky', () => (flaky++ < 2 ? new HttpResponse(null, { status: 503 }) : HttpResponse.json({ ok: true }))),
  http.get('https://example.test/missing', () => new HttpResponse(null, { status: 404 })),
)

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
beforeEach(() => {
  freshDb()
  photonCalls = 0
  flaky = 0
})

describe('PhotonGeocoder', () => {
  it('normalizes candidates and caches results in IndexedDB', async () => {
    const g = new PhotonGeocoder()
    const [c] = await g.search({ text: 'Kronotrop', near: { lat: 41, lng: 29 } })
    expect(c).toMatchObject({ name: 'Kronotrop', lat: 40.9812, lng: 29.0257, osmId: 'node/123', neighborhood: 'Moda', city: 'Istanbul', countryCode: 'TR' })
    expect(c!.osmTags).toEqual({ amenity: 'cafe', name: 'Kronotrop' })
    await g.search({ text: 'Kronotrop', near: { lat: 41, lng: 29 } })
    expect(photonCalls).toBe(1)
  })
})

describe('NominatimGeocoder', () => {
  it('reverse geocodes with the neighborhood fallback chain and keeps POI tags', async () => {
    const hit = await new NominatimGeocoder().reverse({ lat: 38.7118, lng: -9.13 })
    expect(hit).toMatchObject({ name: 'Miradouro de Santa Luzia', neighborhood: 'Alfama', city: 'Lisboa', countryCode: 'PT', osmId: 'node/456' })
    expect(hit!.osmTags).toMatchObject({ tourism: 'viewpoint', opening_hours: '24/7' })
  })
})

describe('fetchJson', () => {
  it('retries server errors with backoff', async () => {
    await expect(fetchJson('https://example.test/flaky', { backoffMs: 1 })).resolves.toEqual({ ok: true })
    expect(flaky).toBe(3)
  })
  it('does not retry client errors', async () => {
    await expect(fetchJson('https://example.test/missing', { backoffMs: 1 })).rejects.toBeInstanceOf(HttpError)
  })
})
