// Core records stored in IndexedDB. Google-sourced fields, app-derived fields and
// user edits are kept apart so a re-import never overwrites enrichment or edits.

export type ListRole = 'visited' | 'wantToGo' | 'favorite' | 'other'

/** Title given to rows Takeout exported without one; nothing to search for. */
export const UNTITLED_PLACE = 'Untitled place'

export type ResolveStatus =
  | 'pending' // waiting for the resolve stage; may already carry an approximate point (coordSource 'fid')
  | 'resolved' // accepted automatically (confidence > 0.85) or came with coordinates
  | 'flagged' // accepted but worth a second look (0.5 to 0.85)
  | 'review' // needs a human decision (< 0.5 or no candidates)
  | 'manual' // placed by the user

/**
 * Where coordinates came from. `fid` is the approximate point decoded from the
 * Google feature ID; the resolve stage refines it, through Google Place Details
 * (`google`) when a key is set, otherwise an OSM geocoder.
 */
export type CoordSource = 'takeout' | 'url' | 'fid' | 'google' | 'geocoder' | 'manual'

export type BusinessStatus = 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY'

export type StageName = 'resolve' | 'match' | 'classify' | 'area' | 'embed'

export interface Place {
  id: string
  /** Google feature ID, e.g. 0x14cab9e7a7777c43:0x4b2b8b3e1e2a3f0a */
  googleFid?: string
  /** Decimal CID; equals the second half of the feature ID. Starred places only carry this. */
  googleCid?: string
  googleUrl?: string
  title: string
  /** Address as Google exported it (starred places only). */
  googleAddress?: string
  /** Places API ID (ChIJ…), built from the feature ID and confirmed by Place Details. */
  googlePlaceId?: string
  /** Place Details types, most specific first, e.g. steak_house, restaurant, food. */
  googleTypes?: string[]
  googlePrimaryType?: string
  businessStatus?: BusinessStatus

  lat?: number
  lng?: number
  coordSource?: CoordSource
  resolveStatus: ResolveStatus
  resolveConfidence?: number
  resolveSource?: string
  /** Top geocoder candidates kept for the review screen when not auto-accepted. */
  resolveCandidates?: ResolveCandidate[]

  osmId?: string
  osmTags?: Record<string, string>
  /** When the OSM match stage last looked for this place, found or not. */
  matchCheckedAt?: number

  address?: string
  countryCode?: string
  country?: string
  region?: string
  city?: string
  neighborhood?: string

  category?: string
  subcategory?: string
  aiTags: string[]
  priceLevel?: number | null
  openingHours?: string
  website?: string
  summary?: string

  firstSeenAt: number
  updatedAt: number
}

export interface ResolveCandidate {
  name: string
  lat: number
  lng: number
  osmId?: string
  address?: string
  score: number
}

export interface List {
  id: string
  name: string
  /** null until the user assigns a role. */
  role: ListRole | null
  suggestedRole: ListRole
  color: string
  description?: string
  /** Starred places come from Saved Places.json rather than a list CSV. */
  source: 'csv' | 'starred'
  createdAt: number
}

export interface Membership {
  placeId: string
  listId: string
  /** The place's title as this list wrote it; lists saved in different languages disagree. */
  title?: string
  note?: string
  googleTags?: string
  comment?: string
  addedAt: number
  /** Set when the row disappears from the list on a later import. */
  removedAt?: number
}

export interface Visit {
  date: number
  rating?: number
  note?: string
}

export interface UserData {
  placeId: string
  userTags: string[]
  userNote?: string
  visits: Visit[]
  pinned?: boolean
  /** Coordinates the user set by hand ("fix location"). */
  manualLat?: number
  manualLng?: number
}

export interface Embedding {
  placeId: string
  model: string
  vector: Float32Array
  textHash: string
}

export interface ImportCounts {
  newPlaces: number
  updatedPlaces: number
  newMemberships: number
  removedMemberships: number
  restoredMemberships: number
  newLists: number
  skippedFiles: number
  needsResolve: number
  warnings: number
}

export interface ImportRecord {
  id?: number
  date: number
  /** File path inside the zip -> SHA-256 of its content. */
  fileHashes: Record<string, string>
  counts: ImportCounts
  warnings: string[]
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error'

export interface Job {
  /** `${stage}:${placeId}` */
  id: string
  stage: StageName
  placeId: string
  status: JobStatus
  attempts: number
  /** Earliest time the job may run again (backoff). */
  notBefore: number
  error?: string
  updatedAt: number
}

export interface CacheEntry {
  key: string
  value: unknown
  createdAt: number
}

export interface Setting {
  key: string
  value: unknown
}

export interface SavedView {
  id: string
  name: string
  /** URL query string produced by the filter encoder. */
  query: string
  createdAt: number
}
