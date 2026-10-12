import { describe, expect, it } from 'vitest'
import type { OsmPoi } from '../services/overpass'
import { bestPoi, matchPatch } from './match'

const poi = (id: string, lat: number, lng: number, tags: Record<string, string>): OsmPoi => ({ osmId: `node/${id}`, lat, lng, tags })
const tower = poi('1', 41.0256, 28.9741, { name: 'Galata Kulesi', 'name:en': 'Galata Tower', opening_hours: 'Mo-Su 08:30-23:00', website: 'https://galatakulesi.example' })
const square = poi('2', 41.0255, 28.9745, { name: 'Galata Meydanı' })
const farTower = poi('3', 41.03, 28.98, { name: 'Galata Tower' })

describe('bestPoi', () => {
  it('matches on any name a list may have used, within the radius', () => {
    expect(bestPoi({ title: 'Galata Tower', lat: 41.02562, lng: 28.97418 }, [square, tower, farTower])?.osmId).toBe('node/1')
    expect(bestPoi({ title: 'Galata Kulesi', lat: 41.02562, lng: 28.97418 }, [square, tower])?.osmId).toBe('node/1')
  })

  it('finds nothing when the names differ or the feature is too far', () => {
    expect(bestPoi({ title: 'Pandeli', lat: 41.02562, lng: 28.97418 }, [tower, square])).toBeNull()
    expect(bestPoi({ title: 'Galata Tower', lat: 41.02562, lng: 28.97418 }, [farTower])).toBeNull()
  })

  it('carries hours and website over', () => {
    expect(matchPatch(tower)).toMatchObject({ osmId: 'node/1', openingHours: 'Mo-Su 08:30-23:00', website: 'https://galatakulesi.example' })
  })
})
