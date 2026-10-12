// Google feature IDs ("0x14cab9bd6570f4e1:0xe52df7368a157ca4") start with an S2
// cell ID near where Google first placed the feature. Decoding it puts a list
// row on the map without any network call, but only approximately. Measured
// on 50 random places from the owner's export (scripts/accuracy.ts): half are
// within 200 m, a third are 0.5 to 20 km off (places Google moved, and IDs
// whose low bits are zeroed to a coarse cell). So the point narrows a search
// to a region; it is never treated as the place's position.

const LOOKUP_BITS = 4
const SWAP = 1
const INVERT = 2
const MAX_LEVEL = 30
const POS_TO_IJ = [
  [0, 1, 3, 2],
  [0, 2, 3, 1],
  [3, 2, 0, 1],
  [3, 1, 0, 2],
]
const POS_TO_ORIENTATION = [SWAP, 0, 0, INVERT | SWAP]

const lookupPos = new Int32Array(1 << (2 * LOOKUP_BITS + 2))
const lookupIj = new Int32Array(1 << (2 * LOOKUP_BITS + 2))

function initLookup(level: number, i: number, j: number, orig: number, pos: number, orientation: number): void {
  if (level === LOOKUP_BITS) {
    const ij = (i << LOOKUP_BITS) + j
    lookupPos[(ij << 2) + orig] = (pos << 2) + orientation
    lookupIj[(pos << 2) + orig] = (ij << 2) + orientation
    return
  }
  const r = POS_TO_IJ[orientation]!
  for (let index = 0; index < 4; index++) {
    initLookup(level + 1, (i << 1) + (r[index]! >> 1), (j << 1) + (r[index]! & 1), orig, (pos << 2) + index, orientation ^ POS_TO_ORIENTATION[index]!)
  }
}
for (const o of [0, SWAP, INVERT, SWAP | INVERT]) initLookup(0, 0, 0, o, 0, o)

function stToUv(s: number): number {
  return s >= 0.5 ? (4 * s * s - 1) / 3 : (1 - 4 * (1 - s) * (1 - s)) / 3
}

function uvToSt(u: number): number {
  return u >= 0 ? 0.5 * Math.sqrt(1 + 3 * u) : 1 - 0.5 * Math.sqrt(1 - 3 * u)
}

const DEG = 180 / Math.PI

/** Center of an S2 cell, or undefined for IDs that are not valid cells (e.g. the 0x0 in review URLs). */
export function s2CellToLatLng(id: bigint): { lat: number; lng: number } | undefined {
  if (id <= 0n || id >> 64n !== 0n) return undefined
  const face = Number(id >> 61n)
  if (face > 5) return undefined

  let bits = face & SWAP
  let i = 0
  let j = 0
  for (let k = 7; k >= 0; k--) {
    const nbits = k === 7 ? MAX_LEVEL - 7 * LOOKUP_BITS : LOOKUP_BITS
    bits += Number((id >> BigInt(k * 2 * LOOKUP_BITS + 1)) & BigInt((1 << (2 * nbits)) - 1)) << 2
    bits = lookupIj[bits]!
    // Multiply rather than shift: the top chunk would overflow 32-bit shifts.
    i += (bits >> (LOOKUP_BITS + 2)) * 2 ** (k * LOOKUP_BITS)
    j += ((bits >> 2) & ((1 << LOOKUP_BITS) - 1)) * 2 ** (k * LOOKUP_BITS)
    bits &= SWAP | INVERT
  }

  const u = stToUv((i + 0.5) / 2 ** MAX_LEVEL)
  const v = stToUv((j + 0.5) / 2 ** MAX_LEVEL)
  const [x, y, z] = [
    [1, u, v],
    [-u, 1, v],
    [-u, -v, 1],
    [-1, -v, -u],
    [v, -1, -u],
    [v, u, -1],
  ][face]!
  return { lat: Math.atan2(z!, Math.hypot(x!, y!)) * DEG, lng: Math.atan2(y!, x!) * DEG }
}

/** Leaf cell containing a point. Used to build realistic feature IDs for the synthetic world. */
export function latLngToS2Cell(lat: number, lng: number): bigint {
  const phi = lat / DEG
  const theta = lng / DEG
  const p = [Math.cos(phi) * Math.cos(theta), Math.cos(phi) * Math.sin(theta), Math.sin(phi)]
  const abs = p.map(Math.abs)
  let face = abs[0]! > abs[1]! ? (abs[0]! > abs[2]! ? 0 : 2) : abs[1]! > abs[2]! ? 1 : 2
  if (p[face]! < 0) face += 3
  const [x, y, z] = p as [number, number, number]
  const [u, v] = [
    [y / x, z / x],
    [-x / y, z / y],
    [-x / z, -y / z],
    [z / x, y / x],
    [z / y, -x / y],
    [-y / z, -x / z],
  ][face]!
  const size = 2 ** MAX_LEVEL
  const i = Math.max(0, Math.min(size - 1, Math.floor(size * uvToSt(u!))))
  const j = Math.max(0, Math.min(size - 1, Math.floor(size * uvToSt(v!))))

  let pos = 0n
  let bits = face & SWAP
  const mask = (1 << LOOKUP_BITS) - 1
  for (let k = 7; k >= 0; k--) {
    const scale = 2 ** (k * LOOKUP_BITS)
    bits += (Math.floor(i / scale) & mask) << (LOOKUP_BITS + 2)
    bits += (Math.floor(j / scale) & mask) << 2
    bits = lookupPos[bits]!
    pos |= BigInt(bits >> 2) << BigInt(k * 2 * LOOKUP_BITS)
    bits &= SWAP | INVERT
  }
  return (((BigInt(face) << 60n) | pos) << 1n) + 1n
}

/** Approximate position encoded in a feature ID's first half. */
export function fidToLatLng(fid: string): { lat: number; lng: number } | undefined {
  const m = /^(0x[0-9a-f]{1,16}):0x[0-9a-f]{1,16}$/i.exec(fid.trim())
  if (!m) return undefined
  const point = s2CellToLatLng(BigInt(m[1]!))
  if (!point) return undefined
  return { lat: Math.round(point.lat * 1e6) / 1e6, lng: Math.round(point.lng * 1e6) / 1e6 }
}
