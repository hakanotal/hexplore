// Extracts stable identifiers and coordinates from Google Maps URLs found in Takeout.
//
// List CSVs carry URLs like
//   https://www.google.com/maps/place/Name/data=!4m2!3m1!1s0x14cab9e7a7777c43:0x4b2b8b3e1e2a3f0a
// Starred places carry
//   http://maps.google.com/?cid=5416391217826545418
// The CID is the second half of the feature ID in decimal, so both sources map to the same key.
// Dropped pins have no feature ID, only coordinates.

export interface GoogleUrlInfo {
  fid?: string
  cid?: string
  lat?: number
  lng?: number
  /** Coordinates came from a dropped pin or an explicit place marker, not the viewport. */
  exactCoords: boolean
}

const FID_RE = /(0x[0-9a-f]{1,16}):(0x[0-9a-f]{1,16})/i
const FID_DATA_RE = /!1s(0x[0-9a-f]{1,16}:0x[0-9a-f]{1,16})/i
const CID_RE = /[?&]cid=(\d+)/
const FTID_RE = /[?&]ftid=(0x[0-9a-f]{1,16}:0x[0-9a-f]{1,16})/i
const DATA_COORDS_RE = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/
const SEARCH_COORDS_RE = /\/maps\/search\/(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)/
const Q_COORDS_RE = /[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)/
const AT_COORDS_RE = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/
const DMS_RE =
  /(\d{1,3})°(\d{1,2})'(\d{1,2}(?:\.\d+)?)"([NS])[\s+,]*(\d{1,3})°(\d{1,2})'(\d{1,2}(?:\.\d+)?)"([EW])/

export function fidToCid(fid: string): string | undefined {
  const m = FID_RE.exec(fid)
  if (!m) return undefined
  try {
    return BigInt(m[2]!).toString(10)
  } catch {
    return undefined
  }
}

function validCoords(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
}

function dmsToDecimal(deg: string, min: string, sec: string, hemi: string): number {
  const value = Number(deg) + Number(min) / 60 + Number(sec) / 3600
  return hemi === 'S' || hemi === 'W' ? -value : value
}

export function parseGoogleUrl(raw: string | undefined | null): GoogleUrlInfo {
  const info: GoogleUrlInfo = { exactCoords: false }
  if (!raw) return info
  let url = raw.trim()
  try {
    url = decodeURIComponent(url)
  } catch {
    // keep the raw string when it has stray % signs
  }

  const fid = FID_DATA_RE.exec(url)?.[1] ?? FTID_RE.exec(url)?.[1]
  if (fid) {
    info.fid = fid.toLowerCase()
    info.cid = fidToCid(fid)
  }
  const cid = CID_RE.exec(url)?.[1]
  if (cid) info.cid = cid

  const exact = DATA_COORDS_RE.exec(url) ?? SEARCH_COORDS_RE.exec(url) ?? Q_COORDS_RE.exec(url)
  if (exact) {
    const lat = Number(exact[1])
    const lng = Number(exact[2])
    if (validCoords(lat, lng)) Object.assign(info, { lat, lng, exactCoords: true })
    return info
  }

  const dms = DMS_RE.exec(url)
  if (dms) {
    const lat = dmsToDecimal(dms[1]!, dms[2]!, dms[3]!, dms[4]!)
    const lng = dmsToDecimal(dms[5]!, dms[6]!, dms[7]!, dms[8]!)
    if (validCoords(lat, lng)) Object.assign(info, { lat, lng, exactCoords: true })
    return info
  }

  // The @lat,lng segment is the map viewport. Only trust it when there is no
  // feature ID, which is the case for dropped pins shared from the app.
  if (!info.fid && !info.cid) {
    const at = AT_COORDS_RE.exec(url)
    if (at) {
      const lat = Number(at[1])
      const lng = Number(at[2])
      if (validCoords(lat, lng)) Object.assign(info, { lat, lng, exactCoords: false })
    }
  }
  return info
}

/** Small, fast, non-cryptographic string hash (cyrb53) for fallback keys. */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * Stable place key. Google CID when present, coordinates for dropped pins,
 * otherwise a hash of title plus list name.
 */
export function placeKey(info: GoogleUrlInfo, title: string, listName: string): string {
  if (info.cid) return `g${info.cid}`
  if (info.lat !== undefined && info.lng !== undefined) return `p${info.lat.toFixed(5)},${info.lng.toFixed(5)}`
  return `h${hashString(`${title.trim().toLowerCase()}|${listName.trim().toLowerCase()}`)}`
}
