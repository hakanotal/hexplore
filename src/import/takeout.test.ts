import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { buildSampleTakeout, buildSampleTakeoutZip } from '../dev/sampleTakeout'
import { haversineKm } from '../pipeline/similarity'
import { readTakeout, STARRED_LIST_ID } from './takeout'

describe('readTakeout', () => {
  it('reads every list and the starred places from a sample zip', async () => {
    const zip = buildSampleTakeoutZip({ count: 120 })
    const parsed = await readTakeout([{ path: 'takeout.zip', data: zip }])
    const names = parsed.lists.map((l) => l.name).sort()
    expect(names).toEqual(['Coffee ☕', 'Favorite places', 'Images', 'Istanbul', 'Lisbon trip', 'Starred places', 'Visited', 'Want to go'])
    expect(parsed.ignored.sort()).toEqual([
      'Takeout/Maps (your places)/Reviews.json',
      'Takeout/Maps/My labeled places/Labeled places.json',
      'Takeout/Saved/Default list(1).csv',
      'Takeout/archive_browser.html',
    ])
    expect(parsed.warnings).toEqual([])

    const lisbon = parsed.lists.find((l) => l.name === 'Lisbon trip')!
    expect(lisbon.description).toBe('Lisbon, long weekend in May')

    const want = parsed.lists.find((l) => l.name === 'Want to go')!
    const pins = want.rows.filter((r) => r.placeId.startsWith('p'))
    expect(pins.map((p) => p.title)).toEqual(['Dropped pin', 'İşaretli Yer', expect.stringMatching(/^\d+°\d+'[\d.]+"N \d+°\d+'[\d.]+"E$/), 'Dropped pin'])
    expect(pins.every((p) => p.coordSource === 'url')).toBe(true)
    expect(want.rows.find((r) => !r.url)?.placeId).toMatch(/^h/)
  })

  it('places list rows near the real place from the feature ID alone', async () => {
    const { files, world } = buildSampleTakeout({ count: 200 })
    const parsed = await readTakeout(Object.entries(files).map(([path, data]) => ({ path, data })))
    const truth = new Map(world.map((w) => [`g${w.cid}`, w]))
    const rows = parsed.lists.filter((l) => l.source === 'csv').flatMap((l) => l.rows.filter((r) => r.googleFid))
    expect(rows.length).toBeGreaterThan(100)
    for (const r of rows) {
      expect(r.coordSource).toBe('fid')
      expect(haversineKm({ lat: r.lat!, lng: r.lng! }, truth.get(r.placeId)!)).toBeLessThan(0.1)
    }
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
    const url = 'https://www.google.com/maps/place/A/data=!4m2!3m1!1s0x14cab9e7a7777c43:0x1'
    const loose = await readTakeout([{ path: 'My list.csv', data: strToU8(`Title,URL\nA,${url}\n`) }])
    expect(loose.lists[0]!.name).toBe('My list')
    const empty = await readTakeout([{ path: 'x.zip', data: zipSync({ 'a.txt': strToU8('hi') }) }])
    expect(empty.lists).toHaveLength(0)
    expect(empty.warnings[0]).toMatch(/Saved/)
  })

  it('skips rows that are not Maps places and keeps the rest of the list', async () => {
    const csv = 'Title,Note,URL,Tags,Comment\n,,,,\nThe Man from Earth,,https://www.google.com,,\nPier 39,,http://maps.google.com/?cid=42,,\n'
    const parsed = await readTakeout([{ path: 'Mixed.csv', data: strToU8(csv) }])
    expect(parsed.lists[0]!.rows.map((r) => r.title)).toEqual(['Pier 39'])
    expect(parsed.warnings).toEqual(['Mixed: skipped 1 row that is not a Google Maps place'])
  })

  it('skips Reviews.json and Labeled places.json even though both are GeoJSON', async () => {
    const reviews = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { five_star_rating_published: 5 } }] }
    const labeled = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [29, 41] }, properties: { name: 'Home' } }] }
    const parsed = await readTakeout([
      { path: 'Takeout/Maps (your places)/Reviews.json', data: strToU8(JSON.stringify(reviews)) },
      { path: 'Takeout/Maps/My labeled places/Labeled places.json', data: strToU8(JSON.stringify(labeled)) },
    ])
    expect(parsed.lists).toHaveLength(0)
  })
})
