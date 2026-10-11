import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { buildSampleTakeout, buildSampleTakeoutZip } from '../dev/sampleTakeout'
import { readTakeout, STARRED_LIST_ID } from './takeout'

describe('readTakeout', () => {
  it('reads every list and the starred places from a sample zip', async () => {
    const zip = buildSampleTakeoutZip({ count: 120 })
    const parsed = await readTakeout([{ path: 'takeout.zip', data: zip }])
    const names = parsed.lists.map((l) => l.name).sort()
    expect(names).toEqual(['Coffee ☕', 'Favorite places', 'Lisbon trip', 'Starred places', 'Travel plans', 'Visited', 'Want to go'])
    expect(parsed.ignored).toEqual(['Takeout/archive_browser.html'])

    const lisbon = parsed.lists.find((l) => l.name === 'Lisbon trip')!
    expect(lisbon.description).toBe('Lisbon, long weekend in May')

    const want = parsed.lists.find((l) => l.name === 'Want to go')!
    const pins = want.rows.filter((r) => r.title === 'Dropped pin')
    expect(pins).toHaveLength(3)
    expect(pins.every((p) => p.coordSource === 'url' && p.placeId.startsWith('p'))).toBe(true)
    expect(want.rows.find((r) => !r.url)?.placeId).toMatch(/^h/)
  })

  it('gives a list row and a starred place for the same Google place the same key', async () => {
    const { files, world } = buildSampleTakeout({ count: 200 })
    const parsed = await readTakeout(Object.entries(files).map(([path, data]) => ({ path, data })))
    const starred = parsed.lists.find((l) => l.listId === STARRED_LIST_ID)!
    const csvIds = new Set(parsed.lists.filter((l) => l.source === 'csv').flatMap((l) => l.rows.map((r) => r.placeId)))
    const overlap = starred.rows.filter((r) => csvIds.has(r.placeId))
    expect(overlap.length).toBeGreaterThan(0)
    const sample = world.find((w) => `g${w.cid}` === overlap[0]!.placeId)
    expect(sample).toBeDefined()
    expect(starred.rows.some((r) => r.lat === undefined)).toBe(true) // [0,0] positions
  })

  it('accepts loose CSV files and finds nothing in unrelated archives', async () => {
    const loose = await readTakeout([{ path: 'My list.csv', data: strToU8('Title,URL\nA,u\n') }])
    expect(loose.lists[0]!.name).toBe('My list')
    const empty = await readTakeout([{ path: 'x.zip', data: zipSync({ 'a.txt': strToU8('hi') }) }])
    expect(empty.lists).toHaveLength(0)
    expect(empty.warnings[0]).toMatch(/Saved/)
  })

  it('skips Reviews.json even though it is GeoJSON', async () => {
    const reviews = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { five_star_rating_published: 5 } }] }
    const parsed = await readTakeout([{ path: 'Takeout/Maps (your places)/Reviews.json', data: strToU8(JSON.stringify(reviews)) }])
    expect(parsed.lists).toHaveLength(0)
  })
})
