import type { CoordSource, ImportCounts, List, ListRole, Membership, Place } from '../domain/types'
import type { ParsedTakeout, SourceRow } from './takeout'

// Pure merge of a parsed Takeout into the existing store. Produces the exact set
// of writes, so the logic is testable without IndexedDB and the database layer
// only has to apply it in one transaction.

export interface ExistingState {
  places: Map<string, Place>
  lists: Map<string, List>
  /** Current memberships for every list present in the import. */
  memberships: Membership[]
  /** File path -> hash from the most recent import. */
  lastFileHashes: Record<string, string>
}

export interface ImportPlan {
  putPlaces: Place[]
  putLists: List[]
  putMemberships: Membership[]
  fileHashes: Record<string, string>
  /** Places that still need coordinates. */
  resolveIds: string[]
  counts: ImportCounts
  warnings: string[]
  /** Lists created by this import that need a role from the user. */
  newListIds: string[]
}

const LIST_COLORS = ['#e4572e', '#2e86ab', '#3a9d23', '#c9a227', '#8e44ad', '#d81b60', '#00897b', '#f39c12', '#1e88e5', '#6d4c41']

const ROLE_PATTERNS: [ListRole, RegExp][] = [
  ['visited', /\b(visited|been( there)?|done|went|gittim|gittiklerim|gidilen|besucht|visité|visitados?)\b/i],
  ['wantToGo', /\b(want to go|to ?go|wish ?list|bucket|to visit|someday|trip|gidilecek|gitmek istediklerim|travel plans)\b/i],
  ['favorite', /\b(fav(ou?rite)?s?|loved?|best|starred|top|favoriler)\b/i],
]

export function suggestRole(name: string, source: 'csv' | 'starred'): ListRole {
  if (source === 'starred') return 'favorite'
  for (const [role, re] of ROLE_PATTERNS) if (re.test(name)) return role
  return 'other'
}

function emptyCounts(): ImportCounts {
  return {
    newPlaces: 0,
    updatedPlaces: 0,
    newMemberships: 0,
    removedMemberships: 0,
    restoredMemberships: 0,
    newLists: 0,
    skippedFiles: 0,
    needsResolve: 0,
    warnings: 0,
  }
}

function membershipKey(placeId: string, listId: string): string {
  return `${placeId}\u0000${listId}`
}

// Google-sourced positions, weakest first: the feature ID's S2 cell, a pin or
// place marker in the URL, then Saved Places.json. A stronger or equal source
// replaces a weaker one; geocoder results and manual fixes are never replaced.
const COORD_RANK: Partial<Record<CoordSource, number>> = { fid: 0, url: 1, takeout: 2 }

/**
 * Applies Google-sourced fields from a row. Returns true when anything changed.
 * The title is settled separately once every list has been read.
 */
function applyRowToPlace(place: Place, row: SourceRow): boolean {
  let changed = false
  const set = <K extends keyof Place>(key: K, value: Place[K] | undefined) => {
    if (value !== undefined && place[key] !== value) {
      place[key] = value as Place[K]
      changed = true
    }
  }
  // Lists in different languages write different name slugs for the same
  // feature, so only take the URL when it points somewhere new.
  if (!place.googleUrl || (row.googleFid && row.googleFid !== place.googleFid)) set('googleUrl', row.url)
  set('googleFid', row.googleFid)
  set('googleCid', row.googleCid)
  set('googleAddress', row.address)
  if (row.countryCode && !place.countryCode) set('countryCode', row.countryCode.toUpperCase())

  const rowRank = row.coordSource ? COORD_RANK[row.coordSource] : undefined
  const placeRank = place.coordSource ? COORD_RANK[place.coordSource] : undefined
  const hasRowCoords = row.lat !== undefined && row.lng !== undefined && rowRank !== undefined
  const canOverwrite = place.lat === undefined || (placeRank !== undefined && rowRank !== undefined && rowRank >= placeRank)
  if (hasRowCoords && canOverwrite && (place.lat !== row.lat || place.lng !== row.lng || place.coordSource !== row.coordSource)) {
    place.lat = row.lat
    place.lng = row.lng
    place.coordSource = row.coordSource
    if (row.coordSource === 'fid') {
      // Approximate, so the resolve stage still looks for the exact POI.
      place.resolveStatus = 'pending'
      place.resolveConfidence = undefined
      place.resolveSource = undefined
    } else {
      place.resolveStatus = 'resolved'
      place.resolveConfidence = 1
      place.resolveSource = row.coordSource
    }
    changed = true
  }
  return changed
}

function newPlace(row: SourceRow, now: number): Place {
  const hasCoords = row.lat !== undefined && row.lng !== undefined
  const exact = hasCoords && row.coordSource !== 'fid'
  return {
    id: row.placeId,
    title: row.title,
    googleFid: row.googleFid,
    googleCid: row.googleCid,
    googleUrl: row.url,
    googleAddress: row.address,
    countryCode: row.countryCode?.toUpperCase(),
    lat: row.lat,
    lng: row.lng,
    coordSource: row.coordSource,
    resolveStatus: exact ? 'resolved' : 'pending',
    resolveConfidence: exact ? 1 : undefined,
    resolveSource: exact ? row.coordSource : undefined,
    aiTags: [],
    firstSeenAt: now,
    updatedAt: now,
  }
}

export function planImport(parsed: ParsedTakeout, existing: ExistingState, now = Date.now()): ImportPlan {
  const counts = emptyCounts()
  const warnings = [...parsed.warnings]
  const places = new Map<string, Place>()
  const lists = new Map<string, List>()
  const memberships = new Map<string, Membership>()
  const updatedPlaceIds = new Set<string>()
  const newPlaceIds = new Set<string>()
  const newListIds: string[] = []
  const fileHashes = { ...existing.lastFileHashes }
  /** Titles rows gave existing places, in list order; settled after the loop. */
  const titleCandidates = new Map<string, string[]>()

  const existingMemberships = new Map<string, Membership>()
  for (const m of existing.memberships) existingMemberships.set(membershipKey(m.placeId, m.listId), m)

  const getPlace = (id: string): Place | undefined => {
    const staged = places.get(id)
    if (staged) return staged
    const prev = existing.places.get(id)
    return prev ? structuredClone(prev) : undefined
  }

  let colorIdx = existing.lists.size

  for (const list of parsed.lists) {
    if (existing.lastFileHashes[list.path] === list.hash) {
      counts.skippedFiles++
      continue
    }
    fileHashes[list.path] = list.hash

    let listRecord = lists.get(list.listId) ?? (existing.lists.has(list.listId) ? { ...existing.lists.get(list.listId)! } : undefined)
    // Takeout also exports empty collections that are not Maps lists ("Images",
    // "Screenshots"). A list is created once it has places; a known list that
    // empties out is still processed below so its memberships are removed.
    if (!listRecord && list.rows.length === 0) continue
    if (!listRecord) {
      listRecord = {
        id: list.listId,
        name: list.name,
        role: null,
        suggestedRole: suggestRole(list.name, list.source),
        color: LIST_COLORS[colorIdx++ % LIST_COLORS.length]!,
        description: list.description,
        source: list.source,
        createdAt: now,
      }
      counts.newLists++
      newListIds.push(list.listId)
      lists.set(list.listId, listRecord)
    } else if (list.description && listRecord.description !== list.description) {
      listRecord.description = list.description
      lists.set(list.listId, listRecord)
    }

    const seenInList = new Set<string>()
    for (const row of list.rows) {
      if (seenInList.has(row.placeId)) {
        warnings.push(`${list.name}: "${row.title}" appears more than once${row.rowNumber ? ` (row ${row.rowNumber})` : ''}, kept the first`)
        continue
      }
      seenInList.add(row.placeId)

      let place = getPlace(row.placeId)
      if (!place) {
        place = newPlace(row, now)
        newPlaceIds.add(place.id)
        places.set(place.id, place)
      } else {
        if (applyRowToPlace(place, row)) {
          place.updatedAt = now
          places.set(place.id, place)
          if (!newPlaceIds.has(place.id)) updatedPlaceIds.add(place.id)
        }
        if (row.title !== place.title) {
          const titles = titleCandidates.get(place.id)
          if (titles) titles.push(row.title)
          else titleCandidates.set(place.id, [row.title])
        }
      }

      const key = membershipKey(row.placeId, list.listId)
      const prev = memberships.get(key) ?? existingMemberships.get(key)
      if (!prev) {
        memberships.set(key, {
          placeId: row.placeId,
          listId: list.listId,
          title: row.title,
          note: row.note,
          googleTags: row.tags,
          comment: row.comment,
          addedAt: row.savedAt ?? now,
        })
        counts.newMemberships++
        continue
      }
      const next: Membership = { ...prev }
      let changed = false
      if (prev.removedAt !== undefined) {
        delete next.removedAt
        counts.restoredMemberships++
        changed = true
      }
      for (const [field, value] of [
        ['title', row.title],
        ['note', row.note],
        ['googleTags', row.tags],
        ['comment', row.comment],
      ] as const) {
        if ((prev[field] ?? undefined) !== value) {
          next[field] = value
          changed = true
          if (!newPlaceIds.has(row.placeId)) updatedPlaceIds.add(row.placeId)
        }
      }
      if (changed) memberships.set(key, next)
    }

    // Rows that disappeared from this list lose their membership. The place and
    // all enrichment stay.
    for (const m of existing.memberships) {
      if (m.listId !== list.listId || m.removedAt !== undefined || seenInList.has(m.placeId)) continue
      memberships.set(membershipKey(m.placeId, m.listId), { ...m, removedAt: now })
      counts.removedMemberships++
    }
  }

  // A place saved in two lists can carry two titles (one list saved while the
  // app was in Turkish, another in English). Keep the current title while any
  // active membership still uses it, so re-imports don't flip between them.
  if (titleCandidates.size) {
    const activeTitles = new Map<string, Set<string>>()
    const current = new Map(existingMemberships)
    for (const [key, m] of memberships) current.set(key, m)
    for (const m of current.values()) {
      if (m.removedAt !== undefined || m.title === undefined || !titleCandidates.has(m.placeId)) continue
      const set = activeTitles.get(m.placeId)
      if (set) set.add(m.title)
      else activeTitles.set(m.placeId, new Set([m.title]))
    }
    for (const [placeId, titles] of titleCandidates) {
      const place = getPlace(placeId)!
      if (activeTitles.get(placeId)?.has(place.title)) continue
      place.title = titles[0]!
      place.updatedAt = now
      places.set(placeId, place)
      if (!newPlaceIds.has(placeId)) updatedPlaceIds.add(placeId)
    }
  }

  const putPlaces = [...places.values()]
  const resolveIds = putPlaces.filter((p) => p.resolveStatus === 'pending').map((p) => p.id)
  counts.newPlaces = newPlaceIds.size
  counts.updatedPlaces = updatedPlaceIds.size
  counts.needsResolve = resolveIds.length
  counts.warnings = warnings.length

  return {
    putPlaces,
    putLists: [...lists.values()],
    putMemberships: [...memberships.values()],
    fileHashes,
    resolveIds,
    counts,
    warnings,
    newListIds,
  }
}
