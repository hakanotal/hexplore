import { describe, expect, it } from 'vitest'
import { fidToCid, parseGoogleUrl, placeKey } from './googleUrl'

describe('parseGoogleUrl', () => {
  it('extracts the feature ID and derives the CID', () => {
    const info = parseGoogleUrl('https://www.google.com/maps/place/Moda+Sahili/data=!4m2!3m1!1s0x14cab9e7a7777c43:0x4b2b8b3e1e2a3f0a')
    expect(info.fid).toBe('0x14cab9e7a7777c43:0x4b2b8b3e1e2a3f0a')
    expect(info.cid).toBe(BigInt('0x4b2b8b3e1e2a3f0a').toString())
    expect(info.lat).toBeUndefined()
  })

  it('handles URL-encoded colons in the feature ID', () => {
    const info = parseGoogleUrl('https://www.google.com/maps/place/X/data=!4m2!3m1!1s0x1:0xff%3A')
    expect(info.fid).toBe('0x1:0xff')
    expect(info.cid).toBe('255')
  })

  it('reads the CID from starred place URLs', () => {
    expect(parseGoogleUrl('http://maps.google.com/?cid=5416391217826545418').cid).toBe('5416391217826545418')
  })

  it('reads exact coordinates from place data segments', () => {
    const info = parseGoogleUrl('https://www.google.com/maps/place/X/@41.0,29.0,17z/data=!3m1!4b1!4m6!3m5!1s0xa:0xb!8m2!3d40.9903!4d29.0293')
    expect(info).toMatchObject({ lat: 40.9903, lng: 29.0293, exactCoords: true, cid: '11' })
  })

  it('reads dropped pins from search URLs', () => {
    expect(parseGoogleUrl('https://www.google.com/maps/search/38.711800,-9.130000')).toMatchObject({ lat: 38.7118, lng: -9.13, exactCoords: true })
    expect(parseGoogleUrl('https://www.google.com/maps/search/38.7118,+-9.13')).toMatchObject({ lat: 38.7118, lng: -9.13 })
  })

  it('reads degree-minute-second pins', () => {
    const info = parseGoogleUrl(`https://www.google.com/maps/place/41°00'29.5"N+28°58'42.2"E/@41.0,28.9,17z`)
    expect(info.lat).toBeCloseTo(41.00819, 4)
    expect(info.lng).toBeCloseTo(28.97839, 4)
  })

  it('ignores the viewport when a feature ID exists', () => {
    const info = parseGoogleUrl('https://www.google.com/maps/place/X/@41.0,29.0,17z/data=!4m2!3m1!1s0xa:0xb')
    expect(info.lat).toBeUndefined()
  })

  it('rejects 0,0 and out-of-range coordinates', () => {
    expect(parseGoogleUrl('https://www.google.com/maps/search/0,0').lat).toBeUndefined()
    expect(parseGoogleUrl('https://www.google.com/maps/search/95.1,10').lat).toBeUndefined()
  })

  it('returns an empty result for missing URLs', () => {
    expect(parseGoogleUrl(undefined)).toEqual({ exactCoords: false })
  })
})

describe('placeKey', () => {
  it('prefers CID, then coordinates, then a title hash', () => {
    expect(placeKey({ cid: '9', exactCoords: false }, 'A', 'L')).toBe('g9')
    expect(placeKey({ lat: 1.123456, lng: 2.5, exactCoords: true }, 'A', 'L')).toBe('p1.12346,2.50000')
    const a = placeKey({ exactCoords: false }, 'Ramen ', 'Want to go')
    expect(a).toBe(placeKey({ exactCoords: false }, 'ramen', 'want to go'))
    expect(a).not.toBe(placeKey({ exactCoords: false }, 'ramen', 'other list'))
  })

  it('fidToCid tolerates junk', () => {
    expect(fidToCid('nope')).toBeUndefined()
  })
})
