import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSampleTakeoutZip } from '../dev/sampleTakeout'
import { FixtureGeocoder } from '../dev/fixtureGeocoder'
import { generateWorld } from '../dev/world'
import { importTakeout } from '../db/importRepo'
import type { HexploreDB } from '../db/db'
import { freshDb } from '../test/db'
import { runPipeline, type PipelineServices } from './runner'
import { confidence, FID_CONFIDENCE, resolvePlace, scoreCandidates } from './resolve'
import type { GeoCandidate, Geocoder } from '../services/geocoder'
import type { Place } from '../domain/types'

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
