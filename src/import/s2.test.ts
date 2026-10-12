import { describe, expect, it } from 'vitest'
import { haversineKm } from '../pipeline/similarity'
import { fidToLatLng, latLngToS2Cell, s2CellToLatLng } from './s2'

// Public landmarks from the owner's export with their well-known positions.
const LANDMARKS: [string, string, number, number][] = [
  ['Galata Tower', '0x14cab9e7a7777c43:0x4c76cf3dcc8b330b', 41.02562, 28.97418],
  ['Taksim Square', '0x14cab7650656bd63:0x8ca058b28c20b6c3', 41.03697, 28.985],
  ['Golden Gate Bridge Vista Point South', '0x808586ec0efb2a19:0x40d1dcef188d6991', 37.8077, -122.475],
  ['Complexe Desjardins', '0x4cc91a4fca1ae933:0x9e1c26554e8a2355', 45.5074, -73.563],
]

describe('fidToLatLng', () => {
  it.each(LANDMARKS)('places %s within 150 m', (_name, fid, lat, lng) => {
    const point = fidToLatLng(fid)!
    expect(haversineKm(point, { lat, lng })).toBeLessThan(0.15)
  })

  it('rejects IDs that are not S2 cells', () => {
    expect(fidToLatLng('0x0:0x5619d06d1da990b5')).toBeUndefined()
    expect(fidToLatLng('0xffffffffffffffff:0x1')).toBeUndefined()
    expect(fidToLatLng('nope')).toBeUndefined()
  })
})

describe('latLngToS2Cell', () => {
  it.each([
    [41.0256, 28.9742],
    [-33.8568, 151.2153],
    [64.1466, -21.9426],
    [-54.8019, -68.303],
    [0.0001, 0.0001],
    [89.9, 45],
    [-89.9, -135],
  ])('round-trips %f, %f on every cube face', (lat, lng) => {
    const point = s2CellToLatLng(latLngToS2Cell(lat, lng))!
    expect(haversineKm(point, { lat, lng })).toBeLessThan(0.001)
  })

  it('produces leaf cells like the ones in real feature IDs', () => {
    const id = latLngToS2Cell(41.02562, 28.97418)
    expect(id & 1n).toBe(1n)
    expect(id.toString(16).slice(0, 6)).toBe('14cab9')
  })
})
