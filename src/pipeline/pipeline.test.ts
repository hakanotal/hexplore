import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSampleTakeoutZip } from '../dev/sampleTakeout'
import { FixtureGeocoder } from '../dev/fixtureGeocoder'
import { FixtureOverpass } from '../dev/fixtureOverpass'
import { generateWorld } from '../dev/world'
import { importTakeout } from '../db/importRepo'
import type { HexploreDB } from '../db/db'
import { freshDb } from '../test/db'
import { runPipeline, type PipelineServices } from './runner'
import { confidence, FID_CONFIDENCE, resolvePlace, scoreCandidates } from './resolve'
import type { GeoCandidate, Geocoder } from '../services/geocoder'
import type { Place } from '../domain/types'
import type { GooglePlace, PlaceDetailsService } from '../services/googlePlaces'

let db: HexploreDB
beforeEach(() => {
  db = freshDb()
})

const cand = (name: string, lat: number, lng: number, city?: string): GeoCandidate => ({ name, lat, lng, city, osmTags: {}, source: 't' })

describe('confidence scoring', () => {
  it('accepts a single exact match with no context', () => {
    const s = scoreCandidates('Kronotrop', [cand('Kronotrop', 41, 29)], { lists: [], hints: [] })
    expect(confidence(s)!.value).toBe(1)
  })

  it('flags identical names in two places when nothing tells them apart', () => {
    const s = scoreCandidates('Starbucks', [cand('Starbucks', 41, 29), cand('Starbucks', 38.7, -9.1)], { lists: [], hints: [] })
    const c = confidence(s)!
    expect(c.value).toBeGreaterThanOrEqual(0.5)
    expect(c.value).toBeLessThan(0.85)
  })

  it('uses the list cluster to pick the right one', () => {
    const ctx = { lists: [{ clusters: [{ lat: 38.71, lng: -9.14, count: 20, share: 0.95, city: 'Lisbon' }], concentration: 0.9 }], hints: [] }
    const s = scoreCandidates('Starbucks', [cand('Starbucks', 41, 29), cand('Starbucks', 38.712, -9.139)], ctx)
    expect(s[0]!.candidate.lat).toBe(38.712)
    expect(confidence(s)!.value).toBeGreaterThan(0.85)
  })

  it('treats a note naming the city as strong evidence', () => {
    const s = scoreCandidates('Five Guys', [cand('Five Guys', 52.5, 13.4, 'Berlin'), cand('Five Guys', 48.86, 2.36, 'Paris')], {
      lists: [],
      hints: ['the one in Paris near the canal'],
    })
    expect(s[0]!.candidate.city).toBe('Paris')
  })

  it('blends in an LLM verdict', () => {
    const s = scoreCandidates('Starbucks', [cand('Starbucks', 41, 29), cand('Starbucks', 38.7, -9.1)], { lists: [], hints: [] })
    expect(confidence(s, { index: 1, confidence: 0.95 })).toMatchObject({ index: 1 })
  })
})

describe('resolving a feature ID point', () => {
  const place = (title: string): Place => ({
    id: 'g1', title, lat: 41.0256, lng: 28.9742, coordSource: 'fid', resolveStatus: 'pending', aiTags: [], firstSeenAt: 0, updatedAt: 0,
  })
  const geocoder = (...candidates: GeoCandidate[]): Geocoder => ({ id: 'stub', search: async () => candidates })
  const ctx = { lists: [], hints: [] }

  it('takes the matching POI next to the point', async () => {
    const out = await resolvePlace(place('Galata Tower'), { geocoder: geocoder(cand('Galata Tower', 41.02562, 28.97418, 'Istanbul')), ctx, final: false })
    expect(out).toMatchObject({ kind: 'commit', patch: { coordSource: 'geocoder', resolveStatus: 'resolved', city: 'Istanbul' } })
  })

  it('beats a same-named branch across town', async () => {
    const near = cand('Starbucks', 41.0262, 28.9748)
    const far = cand('Starbucks', 40.99, 29.03)
    const out = await resolvePlace(place('Starbucks'), { geocoder: geocoder(far, near), ctx, final: false })
    expect(out).toMatchObject({ kind: 'commit', patch: { lat: near.lat, resolveStatus: 'resolved' } })
  })

  it("keeps Google's point and offers a distant same-named match for review", async () => {
    const out = await resolvePlace(place('La Grande Roue'), { geocoder: geocoder(cand('La Grande Roue', 41.045, 28.99)), ctx, final: false })
    expect(out).toMatchObject({ kind: 'commit', patch: { coordSource: 'fid', resolveStatus: 'flagged' } })
    if (out.kind === 'commit') expect(out.patch.resolveCandidates).toHaveLength(1)
  })

  it("keeps Google's point when nothing matches, and skips the search for untitled rows", async () => {
    const out = await resolvePlace(place('Rasim abi'), { geocoder: geocoder(cand('Something else', 41.0256, 28.9742)), ctx, final: false })
    expect(out).toMatchObject({ kind: 'commit', patch: { coordSource: 'fid', resolveStatus: 'resolved', resolveConfidence: FID_CONFIDENCE } })
    const search = vi.fn(async () => [])
    const untitled = await resolvePlace(place('Untitled place'), { geocoder: { id: 'stub', search }, ctx, final: false })
    expect(untitled).toMatchObject({ kind: 'commit', patch: { resolveStatus: 'resolved' } })
    expect(search).not.toHaveBeenCalled()
  })
})

describe('resolving through Google Place Details', () => {
  const g: GooglePlace = { placeId: 'ChIJx', name: 'IBB Fatih Sports Centre', lat: 41.01, lng: 28.95, types: ['sports_complex'], primaryType: 'sports_complex', businessStatus: 'OPERATIONAL' }
  const place = (title: string, fid?: string): Place => ({
    id: 'g1', title, googleFid: fid, lat: 41.0256, lng: 28.9742, coordSource: 'fid', resolveStatus: 'pending', aiTags: [], firstSeenAt: 0, updatedAt: 0,
  })
  const ctx = { lists: [], hints: [] }
  const noSearch: Geocoder = { id: 'stub', search: async () => { throw new Error('should not search') } }

  it('takes the exact place and fills a missing title from Google', async () => {
    const places: PlaceDetailsService = { id: 'google', details: async () => g }
    const out = await resolvePlace(place('Untitled place', '0x1:0x2'), { geocoder: noSearch, places, ctx, final: false })
    expect(out).toMatchObject({ kind: 'commit', patch: { lat: 41.01, coordSource: 'google', resolveStatus: 'resolved', googlePrimaryType: 'sports_complex', title: 'IBB Fatih Sports Centre' } })
    const named = await resolvePlace(place('Fatih Spor', '0x1:0x2'), { geocoder: noSearch, places, ctx, final: false })
    if (named.kind === 'commit') expect(named.patch.title).toBeUndefined()
  })

  it('falls back to the OpenStreetMap search when Google has nothing', async () => {
    const places: PlaceDetailsService = { id: 'google', details: async () => null }
    const out = await resolvePlace(place('Galata Tower', '0x1:0x2'), { geocoder: { id: 'stub', search: async () => [cand('Galata Tower', 41.0256, 28.9742)] }, places, ctx, final: false })
    expect(out).toMatchObject({ kind: 'commit', patch: { coordSource: 'geocoder', resolveSource: 'stub' } })
  })
})

describe('runPipeline with the fixture geocoder', () => {
  it('resolves, enriches and classifies a sample import', async () => {
    await importTakeout([{ path: 't.zip', data: buildSampleTakeoutZip({ count: 200 }) }])
    const fixture = new FixtureGeocoder(generateWorld(300))
    const services: PipelineServices = { geocoder: fixture, reverse: fixture }
    const progress: string[] = []
    const result = await runPipeline(db, services, { onProgress: (p) => progress.push(p.stage) })

    const places = await db.places.toArray()
    const pending = places.filter((p) => p.resolveStatus === 'pending')
    expect(pending).toHaveLength(0)
    expect(result.errors).toBe(0)

    const located = places.filter((p) => p.lat !== undefined)
    expect(located.length / places.length).toBeGreaterThan(0.9)
    const review = places.filter((p) => p.resolveStatus === 'review')
    expect(review.map((p) => p.title)).toContain('That ramen place Elif mentioned')
    expect(review.length / places.length).toBeLessThan(0.1)

    // Synthetic ground truth: resolved places must sit near the real one.
    const world = new Map(generateWorld(300).map((w) => [`g${w.cid}`, w]))
    const wrong = places.filter((p) => {
      const truth = world.get(p.id)
      return p.resolveStatus === 'resolved' && truth && (Math.abs(truth.lat - p.lat!) > 0.01 || Math.abs(truth.lng - p.lng!) > 0.01)
    })
    expect(wrong.length / places.length).toBeLessThan(0.02)

    const categorized = places.filter((p) => p.category)
    expect(categorized.length / located.length).toBeGreaterThan(0.8)
    expect(places.filter((p) => p.lat !== undefined && !p.city).length).toBe(0)
    expect(progress).toContain('resolve')
    expect(progress).toContain('classify')
    expect(progress.at(-1)).toBe('idle')
  })

  it('resolves every place with a feature ID through Google, without name searches', async () => {
    await importTakeout([{ path: 't.zip', data: buildSampleTakeoutZip({ count: 120 }) }])
    const world = generateWorld(200)
    const byFid = new Map(world.map((w) => [w.fid, w]))
    const GOOGLE_TYPE: Record<string, string> = { food: 'restaurant', cafe: 'coffee_shop', bar: 'pub', culture: 'museum', nature: 'park', shopping: 'book_store' }
    const places: PlaceDetailsService = {
      id: 'google',
      details: async (fid) => {
        const w = byFid.get(fid)
        const type = w && GOOGLE_TYPE[w.category]
        return w ? { placeId: `ChIJ${w.index}`, name: w.title, lat: w.lat, lng: w.lng, address: w.address, types: type ? [type] : [], primaryType: type } : null
      },
    }
    const fixture = new FixtureGeocoder(world)
    const searched = new Set<string>()
    const geocoder: Geocoder = { id: 'fixture', search: (q) => { searched.add(q.text); return fixture.search(q) } }
    await runPipeline(db, { geocoder, reverse: fixture, places })

    const all = await db.places.toArray()
    // Starred places came with exact coordinates from Saved Places.json and skip the lookup.
    const withFid = all.filter((p) => p.googleFid && p.coordSource !== 'takeout')
    expect(withFid.length).toBeGreaterThan(100)
    expect(withFid.every((p) => p.coordSource === 'google' && p.lat === byFid.get(p.googleFid!)!.lat && p.city)).toBe(true)
    const typed = withFid.filter((p) => GOOGLE_TYPE[byFid.get(p.googleFid!)!.category])
    expect(typed.every((p) => p.category === byFid.get(p.googleFid!)!.category)).toBe(true)
    // Only the row without any URL needed a name search.
    expect([...searched]).toEqual(['That ramen place Elif mentioned'])
  })

  it('matches located places to OSM features once, in area batches', async () => {
    await importTakeout([{ path: 't.zip', data: buildSampleTakeoutZip({ count: 120 }) }])
    const world = generateWorld(200)
    const fixture = new FixtureGeocoder(world)
    const pois = new FixtureOverpass(world)
    await runPipeline(db, { geocoder: fixture, reverse: fixture, pois })

    const places = await db.places.toArray()
    const located = places.filter((p) => p.lat !== undefined)
    expect(located.every((p) => p.matchCheckedAt !== undefined)).toBe(true)
    const withHours = new Set(world.filter((w) => w.osmTags.opening_hours).map((w) => `g${w.cid}`))
    const matchedHours = places.filter((p) => withHours.has(p.id) && p.openingHours)
    expect(matchedHours.length / places.filter((p) => withHours.has(p.id)).length).toBeGreaterThan(0.9)
    // Batched by area: far fewer queries than places.
    expect(pois.calls).toBeLessThan(located.length / 5)

    // A second run finds nothing left to match.
    const before = pois.calls
    await runPipeline(db, { geocoder: fixture, reverse: fixture, pois })
    expect(pois.calls).toBe(before)
  })

  it('backfills the match stage for places located before it existed', async () => {
    await importTakeout([{ path: 't.zip', data: buildSampleTakeoutZip({ count: 60 }) }])
    const world = generateWorld(100)
    const fixture = new FixtureGeocoder(world)
    await runPipeline(db, { geocoder: fixture, reverse: fixture })
    expect((await db.places.toArray()).some((p) => p.matchCheckedAt !== undefined)).toBe(false)

    await runPipeline(db, { geocoder: fixture, reverse: fixture, pois: new FixtureOverpass(world) })
    const located = (await db.places.toArray()).filter((p) => p.lat !== undefined)
    expect(located.every((p) => p.matchCheckedAt !== undefined)).toBe(true)
  })

  it('backs off and retries a failing geocoder without losing work', async () => {
    await importTakeout([{ path: 't.zip', data: buildSampleTakeoutZip({ count: 30 }) }])
    const fixture = new FixtureGeocoder(generateWorld(60))
    const broken: PipelineServices = {
      geocoder: { id: 'broken', search: async () => { throw new Error('429 Too Many Requests') } },
      reverse: fixture,
    }
    const t0 = Date.now()
    const first = await runPipeline(db, broken, { now: () => t0 })
    expect(first.errors).toBeGreaterThan(0)
    const job = (await db.jobs.where('[stage+status]').equals(['resolve', 'queued']).first())!
    expect(job).toMatchObject({ attempts: 1, error: '429 Too Many Requests' })
    expect(job.notBefore).toBeGreaterThan(t0)

    // Later, with a working geocoder, the queue drains.
    await runPipeline(db, { geocoder: fixture, reverse: fixture }, { now: () => t0 + 10_000_000 })
    expect(await db.places.where('resolveStatus').equals('pending').count()).toBe(0)
  })
})
