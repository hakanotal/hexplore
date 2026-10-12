import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { freshDb } from '../test/db'
import { googleUsage, takeGoogleCall } from '../db/settings'
import { fidToPlaceId, GooglePlaces, PLACE_FIELDS, type CallBudget } from './googlePlaces'

const GALATA_FID = '0x14cab9e7a7777c43:0x4c76cf3dcc8b330b'
const GALATA_ID = 'ChIJQ3x3p-e5yhQRCzOLzD3Pdkw'

// Recorded shape of a Place Details (New) response; CI never calls Google.
const galata = {
  id: GALATA_ID,
  displayName: { text: 'Galata Tower', languageCode: 'en' },
  location: { latitude: 41.0256224, longitude: 28.9741765 },
  formattedAddress: 'Bereketzade, Galata Kulesi, 34421 Beyoğlu/İstanbul, Türkiye',
  types: ['historical_landmark', 'tourist_attraction', 'point_of_interest', 'establishment'],
  primaryType: 'historical_landmark',
  businessStatus: 'OPERATIONAL',
}

let calls: URL[] = []
const server = setupServer(
  http.get('https://places.googleapis.com/v1/places/:id', ({ request, params }) => {
    const url = new URL(request.url)
    calls.push(url)
    if (url.searchParams.get('key') !== 'test-key') return HttpResponse.json({ error: { status: 'INVALID_ARGUMENT' } }, { status: 400 })
    if (params.id === GALATA_ID) return HttpResponse.json(galata)
    return HttpResponse.json({ error: { status: 'NOT_FOUND' } }, { status: 404 })
  }),
)

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
beforeEach(() => {
  freshDb()
  calls = []
})

const unlimited: CallBudget = { take: async () => true }

describe('fidToPlaceId', () => {
  it("matches the place ID in Google's own documentation", () => {
    // Google Sydney: place_id ChIJN1t_tDeuEmsRUsoyG83frY4, cid 10281119596374313554
    expect(fidToPlaceId('0x6b12ae37b47f5b37:0x8eaddfcd1b32ca52')).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4')
    expect(fidToPlaceId(GALATA_FID)).toBe(GALATA_ID)
  })

  it('rejects review IDs and junk', () => {
    expect(fidToPlaceId('0x0:0x5619d06d1da990b5')).toBeUndefined()
    expect(fidToPlaceId('nope')).toBeUndefined()
  })
})

describe('GooglePlaces', () => {
  it('looks a place up by ID with the Pro field mask and stores the result', async () => {
    const g = new GooglePlaces('test-key', unlimited)
    const place = await g.details(GALATA_FID)
    expect(place).toMatchObject({ placeId: GALATA_ID, name: 'Galata Tower', lat: 41.0256224, primaryType: 'historical_landmark', businessStatus: 'OPERATIONAL' })
    expect(calls[0]!.searchParams.get('fields')).toBe(PLACE_FIELDS)
    expect(PLACE_FIELDS).not.toMatch(/rating|OpeningHours|websiteUri|priceLevel/)

    await g.details(GALATA_FID)
    expect(calls).toHaveLength(1)
  })

  it('remembers places Google no longer knows', async () => {
    const g = new GooglePlaces('test-key', unlimited)
    expect(await g.details('0x14cab9e7a7777c43:0x1')).toBeNull()
    expect(await g.details('0x14cab9e7a7777c43:0x1')).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('makes no call once the budget is used up, and tries again when it allows', async () => {
    let allow = false
    const g = new GooglePlaces('test-key', { take: async () => allow })
    expect(await g.details(GALATA_FID)).toBeNull()
    expect(calls).toHaveLength(0)
    allow = true
    expect(await g.details(GALATA_FID)).toMatchObject({ name: 'Galata Tower' })
  })

  it('surfaces a bad key instead of treating places as missing', async () => {
    const g = new GooglePlaces('wrong-key', unlimited)
    await expect(g.details(GALATA_FID)).rejects.toThrow(/400/)
  })
})

describe('monthly Google budget', () => {
  it('stops at the limit and starts over the next month', async () => {
    const oct = Date.UTC(2026, 9, 12)
    expect(await takeGoogleCall(oct, 2)).toBe(true)
    expect(await takeGoogleCall(oct, 2)).toBe(true)
    expect(await takeGoogleCall(oct, 2)).toBe(false)
    expect(await googleUsage(oct)).toEqual({ month: '2026-10', calls: 2 })

    const nov = Date.UTC(2026, 10, 1)
    expect(await takeGoogleCall(nov, 2)).toBe(true)
    expect(await googleUsage(nov)).toEqual({ month: '2026-11', calls: 1 })
  })
})
