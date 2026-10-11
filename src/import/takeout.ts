import { unzipSync, strFromU8 } from 'fflate'
import { parseListCsv } from './listCsv'
import { isFeatureCollection, looksLikeReviews, parseStarred } from './starred'
import { hashString, parseGoogleUrl, placeKey } from './googleUrl'
import type { CoordSource } from '../domain/types'

export const STARRED_LIST_ID = 'starred'
export const STARRED_LIST_NAME = 'Starred places'

export interface InputFile {
  path: string
  data: Uint8Array
}

/** One row normalized across list CSVs and starred places. */
export interface SourceRow {
  placeId: string
  title: string
  googleFid?: string
  googleCid?: string
  url?: string
  note?: string
  tags?: string
  comment?: string
  address?: string
  countryCode?: string
  lat?: number
  lng?: number
  coordSource?: CoordSource
  savedAt?: number
  rowNumber?: number
}

export interface SourceList {
  path: string
  listId: string
  name: string
  source: 'csv' | 'starred'
  description?: string
  hash: string
  rows: SourceRow[]
}

export interface ParsedTakeout {
  lists: SourceList[]
  warnings: string[]
  /** Files inside the archive that were not recognized, for the import summary. */
  ignored: string[]
}

export function listIdFor(name: string): string {
  return `l${hashString(name.trim().toLowerCase())}`
}

export function listNameFromPath(path: string): string {
  const file = path.split('/').pop() ?? path
  return file.replace(/\.csv$/i, '').trim()
}

async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function isZip(data: Uint8Array): boolean {
  return data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04
}

/** Expands any zip archives into their entries; loose files pass through. */
export function expandFiles(files: InputFile[]): InputFile[] {
  const out: InputFile[] = []
  for (const f of files) {
    if (isZip(f.data)) {
      const entries = unzipSync(f.data, {
        filter: (file) => !file.name.endsWith('/') && !file.name.startsWith('__MACOSX/'),
      })
      for (const [path, data] of Object.entries(entries)) out.push({ path, data })
    } else {
      out.push(f)
    }
  }
  return out
}

function csvToSourceList(path: string, text: string, hash: string, warnings: string[]): SourceList | null {
  const parsed = parseListCsv(text)
  const name = listNameFromPath(path)
  if (parsed.rows.length === 0 && parsed.warnings.some((w) => w.startsWith('No header'))) return null
  for (const w of parsed.warnings) warnings.push(`${name}: ${w}`)

  const rows: SourceRow[] = parsed.rows.map((r) => {
    const info = parseGoogleUrl(r.url)
    const hasCoords = info.lat !== undefined && info.lng !== undefined
    return {
      placeId: placeKey(info, r.title, name),
      title: r.title,
      googleFid: info.fid,
      googleCid: info.cid,
      url: r.url,
      note: r.note,
      tags: r.tags,
      comment: r.comment,
      lat: info.lat,
      lng: info.lng,
      coordSource: hasCoords ? 'url' : undefined,
      rowNumber: r.rowNumber,
    }
  })
  return { path, listId: listIdFor(name), name, source: 'csv', description: parsed.description, hash, rows }
}

function starredToSourceList(path: string, json: unknown, hash: string, warnings: string[]): SourceList {
  const parsed = parseStarred(json)
  for (const w of parsed.warnings) warnings.push(`${STARRED_LIST_NAME}: ${w}`)
  const rows: SourceRow[] = parsed.places.map((p) => {
    const info = parseGoogleUrl(p.url)
    const lat = p.lat ?? info.lat
    const lng = p.lng ?? info.lng
    const hasCoords = lat !== undefined && lng !== undefined
    return {
      placeId: placeKey({ ...info, lat, lng }, p.title, STARRED_LIST_NAME),
      title: p.title,
      googleFid: info.fid,
      googleCid: info.cid,
      url: p.url,
      comment: p.comment,
      address: p.address,
      countryCode: p.countryCode,
      lat,
      lng,
      coordSource: hasCoords ? (p.lat !== undefined ? 'takeout' : 'url') : undefined,
      savedAt: p.savedAt,
    }
  })
  return { path, listId: STARRED_LIST_ID, name: STARRED_LIST_NAME, source: 'starred', hash, rows }
}

/**
 * Reads a Takeout export (zip or loose files) into normalized lists. Nothing
 * here touches storage, so it runs the same in a worker, in tests and in scripts.
 */
export async function readTakeout(input: InputFile[]): Promise<ParsedTakeout> {
  const warnings: string[] = []
  const ignored: string[] = []
  const lists: SourceList[] = []

  for (const file of expandFiles(input)) {
    const lower = file.path.toLowerCase()
    if (lower.endsWith('.csv')) {
      const text = strFromU8(file.data)
      const list = csvToSourceList(file.path, text, await sha256(file.data), warnings)
      if (list) lists.push(list)
      else ignored.push(file.path)
    } else if (lower.endsWith('.json') || lower.endsWith('.geojson')) {
      let json: unknown
      try {
        json = JSON.parse(strFromU8(file.data))
      } catch {
        ignored.push(file.path)
        continue
      }
      const named = /saved places\.(geo)?json$/i.test(file.path)
      if (isFeatureCollection(json) && (named || !looksLikeReviews(json))) {
        lists.push(starredToSourceList(file.path, json, await sha256(file.data), warnings))
      } else {
        ignored.push(file.path)
      }
    } else {
      ignored.push(file.path)
    }
  }

  if (lists.length === 0) {
    warnings.push('No list CSVs or Saved Places.json found. In Takeout, select "Saved" and "Maps (your places)".')
  }
  return { lists, warnings, ignored }
}
