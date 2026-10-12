import { UNTITLED_PLACE, type Membership, type Place, type ResolveCandidate } from '../domain/types'
import type { GeoCandidate, Geocoder } from '../services/geocoder'
import type { GooglePlace, PlaceDetailsService } from '../services/googlePlaces'
import { haversineKm, nameSimilarity, normalizeName } from './similarity'

// Stage 1: turn a title into coordinates. Places in one list cluster
// geographically, so confident matches are resolved first, each list's
// clusters are computed from them, and ambiguous searches are then scored
// against those clusters.
//
// Most list rows already carry an approximate point decoded from the Google
// feature ID (coordSource 'fid'). With a Google key, Place Details by ID gives
// the exact place. Without one (or past the monthly budget) the point narrows
// the search to a region rather than pinning the place: measured on the
// owner's export, half the points are within 200 m but a third are more than
// a kilometre off (up to ~20 km), so a strong name match anywhere within
// 15 km wins, and the point alone is never treated as resolved.

export const ACCEPT_THRESHOLD = 0.85
export const REVIEW_THRESHOLD = 0.5

export interface Cluster {
  lat: number
  lng: number
  count: number
  /** Share of the list's located places inside this cluster. */
  share: number
  city?: string
}

/** How far from the feature ID point a same-named candidate may sit and still be the place. */
const ANCHOR_RADIUS_KM = 15
/** A candidate this close, with the next one three times further, wins a tie between branches. */
const ANCHOR_NEAR_KM = 1
/**
 * A lone same-named match is taken outright only this close. Further out it
 * is as likely another branch (measured: Junior's in Manhattan for the one in
 * Brooklyn), so the pin moves there but stays flagged.
 */
const ANCHOR_SURE_KM = 1.5
/** Name similarity a candidate needs to count as the place. */
const ANCHOR_NAME_MATCH = 0.85
/** Confidence in the feature ID point when no candidate confirms it: shown, but flagged. */
export const FID_CONFIDENCE = 0.55

const CELL_DEG = 0.25 // ~25 km grid
const CLUSTER_RADIUS_KM = 12
const MAX_PROXIMITY_WEIGHT = 0.4

export interface ListGeo {
  clusters: Cluster[]
  /** Sum of squared cluster shares: 1 for a one-city list, small for a list spread worldwide. */
  concentration: number
}

export function computeListClusters(places: Iterable<Place>, memberships: Membership[]): Map<string, ListGeo> {
  const byId = new Map<string, Place>()
  for (const p of places) if (p.lat !== undefined && p.lng !== undefined) byId.set(p.id, p)

  const cells = new Map<string, Map<string, { lat: number; lng: number; n: number; cities: Map<string, number> }>>()
  const totals = new Map<string, number>()
  for (const m of memberships) {
    if (m.removedAt !== undefined) continue
    const p = byId.get(m.placeId)
    if (!p) continue
    const key = `${Math.floor(p.lat! / CELL_DEG)}:${Math.floor(p.lng! / CELL_DEG)}`
    let listCells = cells.get(m.listId)
    if (!listCells) cells.set(m.listId, (listCells = new Map()))
    let cell = listCells.get(key)
    if (!cell) listCells.set(key, (cell = { lat: 0, lng: 0, n: 0, cities: new Map() }))
    cell.lat += p.lat!
    cell.lng += p.lng!
    cell.n++
    if (p.city) cell.cities.set(p.city, (cell.cities.get(p.city) ?? 0) + 1)
    totals.set(m.listId, (totals.get(m.listId) ?? 0) + 1)
  }

  const out = new Map<string, ListGeo>()
  for (const [listId, listCells] of cells) {
    const total = totals.get(listId)!
    const clusters = [...listCells.values()]
      .filter((c) => c.n >= 2)
      .map((c) => ({
        lat: c.lat / c.n,
        lng: c.lng / c.n,
        count: c.n,
        share: c.n / total,
        city: [...c.cities.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
      }))
      .sort((a, b) => b.count - a.count)
    // Shrink toward zero for lists with few located places: two points in one
    // city are not yet a pattern.
    const shrink = total / (total + 10)
    if (clusters.length) out.set(listId, { clusters, concentration: shrink * clusters.reduce((s, c) => s + c.share ** 2, 0) })
  }
  return out
}

export interface ResolveContext {
  /** Geography of every list the place belongs to. */
  lists: ListGeo[]
  /** Notes and comments from all memberships; often name a city. */
  hints: string[]
}

/** Picks a point to bias the geocoder search toward, if the context is clear enough. */
export function pickBias(ctx: ResolveContext): { lat: number; lng: number } | undefined {
  const hintText = normalizeName(ctx.hints.join(' '))
  const all = ctx.lists.flatMap((l) => l.clusters)
  if (hintText) {
    const named = all.find((c) => c.city && hintText.includes(normalizeName(c.city)))
    if (named) return named
  }
  // Only lists concentrated in one area give a trustworthy bias.
  return all.filter((c) => c.share >= 0.6).sort((a, b) => b.count - a.count)[0]
}

export interface ScoredCandidate {
  candidate: GeoCandidate
  name: number
  proximity: number | null
  score: number
}

function scoreAgainstAnchor(title: string, candidates: GeoCandidate[], anchor: { lat: number; lng: number }): ScoredCandidate[] {
  return candidates
    .map((candidate) => {
      const name = nameSimilarity(title, candidate.name)
      const d = haversineKm(anchor, candidate)
      const proximity = d <= ANCHOR_RADIUS_KM ? 1 - (0.5 * d) / ANCHOR_RADIUS_KM : 0
      return { candidate, name, proximity, score: proximity ? name * proximity : 0 }
    })
    .sort((a, b) => b.score - a.score)
}

// Search results that are never what someone saves: car parks, roads, the
// town or island a place is named after, administrative areas.
const NOT_SAVEABLE: Record<string, true | string[]> = {
  highway: true,
  place: true,
  boundary: true,
  landuse: true,
  building: ['yes', 'house', 'residential', 'apartments'],
  amenity: ['parking', 'parking_entrance', 'parking_space', 'bicycle_parking', 'motorcycle_parking'],
}

export function isSaveable(c: GeoCandidate): boolean {
  for (const [key, value] of Object.entries(c.osmTags)) {
    const rule = NOT_SAVEABLE[key]
    if (rule === true || (Array.isArray(rule) && rule.includes(value))) return false
  }
  return true
}

export function scoreCandidates(
  title: string,
  candidates: GeoCandidate[],
  ctx: ResolveContext,
  anchor?: { lat: number; lng: number },
): ScoredCandidate[] {
  if (anchor) return scoreAgainstAnchor(title, candidates, anchor)
  const hintText = normalizeName(ctx.hints.join(' '))
  const namesCity = (c: GeoCandidate) => !!hintText && !!c.city && hintText.includes(normalizeName(c.city))
  const anyHint = candidates.some(namesCity)
  // The most concentrated list carries the location evidence. A list spread
  // over many cities says little about which of them a name belongs to, so its
  // weight shrinks with concentration; missing clusters are not evidence against.
  const focus = [...ctx.lists].sort((a, b) => b.concentration - a.concentration)[0]
  let weight = focus ? MAX_PROXIMITY_WEIGHT * focus.concentration : 0
  if (anyHint) weight = MAX_PROXIMITY_WEIGHT
  return candidates
    .map((candidate) => {
      const name = nameSimilarity(title, candidate.name)
      let proximity: number | null = null
      if (focus) {
        // Flat inside a city-sized radius: two candidates that each sit in one
        // of the list's clusters stay tied instead of being split by centroid noise.
        const d = Math.min(...focus.clusters.map((c) => haversineKm(c, candidate)))
        proximity = d <= CLUSTER_RADIUS_KM ? 1 : Math.exp(-(d - CLUSTER_RADIUS_KM) / 20)
      }
      // A note that names the candidate's city is strong evidence.
      if (anyHint) proximity = namesCity(candidate) ? 1 : Math.min(proximity ?? 0, 0.3)
      const score = proximity === null ? name : (1 - weight) * name + weight * proximity
      return { candidate, name, proximity, score }
    })
    .sort((a, b) => b.score - a.score)
}

/**
 * Overall confidence for the best candidate: its score, discounted when the
 * runner-up is close (an ambiguous name), optionally blended with an LLM verdict.
 */
export function confidence(scored: ScoredCandidate[], llm?: { index: number; confidence: number } | null): { index: number; value: number } | null {
  if (!scored.length) return null
  let index = 0
  if (llm && llm.index >= 0 && llm.index < scored.length) index = llm.index
  const best = scored[index]!
  const runnerUp = scored.filter((_, i) => i !== index).sort((a, b) => b.score - a.score)[0]
  const margin = runnerUp ? Math.max(0, Math.min(1, (best.score - runnerUp.score) / 0.15)) : 1
  const heuristic = best.score * (0.75 + 0.25 * margin)
  const value = llm && llm.index === index ? 0.5 * heuristic + 0.5 * llm.confidence : heuristic
  return { index, value: Math.round(value * 1000) / 1000 }
}

export interface DisambiguationInput {
  title: string
  hints: string[]
  listNames: string[]
  clusterCities: string[]
  candidates: GeoCandidate[]
}

/** Optional LLM step. Returns the chosen candidate index (or -1 for none) and its confidence. */
export type Disambiguator = (input: DisambiguationInput, signal?: AbortSignal) => Promise<{ index: number; confidence: number } | null>

export type ResolveOutcome =
  | { kind: 'commit'; patch: Partial<Place> }
  /** Not confident yet; retry once clusters exist. */
  | { kind: 'defer' }

export interface ResolveOptions {
  geocoder: Geocoder
  /** Google Place Details; tried first for places with a feature ID. */
  places?: PlaceDetailsService
  ctx: ResolveContext
  final: boolean
  listNames?: string[]
  disambiguate?: Disambiguator
  signal?: AbortSignal
}

function toReviewCandidates(scored: ScoredCandidate[]): ResolveCandidate[] {
  return scored.slice(0, 5).map((s) => ({
    name: s.candidate.name,
    lat: s.candidate.lat,
    lng: s.candidate.lng,
    osmId: s.candidate.osmId,
    address: s.candidate.address,
    score: Math.round(s.score * 1000) / 1000,
  }))
}

export function candidatePatch(c: GeoCandidate): Partial<Place> {
  return {
    lat: c.lat,
    lng: c.lng,
    osmId: c.osmId,
    osmTags: Object.keys(c.osmTags).length ? c.osmTags : undefined,
    address: c.address,
    neighborhood: c.neighborhood,
    city: c.city,
    region: c.region,
    country: c.country,
    countryCode: c.countryCode,
  }
}

function geocoderPatch(chosen: GeoCandidate, value: number, accepted: boolean, scored: ScoredCandidate[], geocoderId: string): Partial<Place> {
  return {
    ...candidatePatch(chosen),
    coordSource: 'geocoder',
    resolveStatus: accepted ? 'resolved' : 'flagged',
    resolveConfidence: value,
    resolveSource: geocoderId,
    resolveCandidates: accepted ? undefined : toReviewCandidates(scored),
  }
}

export function googlePatch(place: Place, g: GooglePlace): Partial<Place> {
  return {
    lat: g.lat,
    lng: g.lng,
    coordSource: 'google',
    resolveStatus: 'resolved',
    resolveConfidence: 1,
    resolveSource: 'google',
    resolveCandidates: undefined,
    googlePlaceId: g.placeId,
    googleTypes: g.types,
    googlePrimaryType: g.primaryType,
    businessStatus: g.businessStatus,
    address: g.address,
    // List titles stay as the owner saved them; only rows exported without one take Google's name.
    ...(place.title === UNTITLED_PLACE && g.name ? { title: g.name } : {}),
  }
}

/** Refines a feature ID point. Never defers: list clusters add nothing to it. */
async function resolveAnchored(place: Place, anchor: { lat: number; lng: number }, opts: ResolveOptions): Promise<ResolveOutcome> {
  // The point stays on the map, flagged, until something confirms it.
  const keep: Partial<Place> = {
    coordSource: 'fid',
    resolveStatus: 'flagged',
    resolveConfidence: FID_CONFIDENCE,
    resolveSource: 'fid',
    resolveCandidates: undefined,
  }
  if (place.title === UNTITLED_PLACE) return { kind: 'commit', patch: keep }

  const candidates = (await opts.geocoder.search({ text: place.title, near: anchor, limit: 8 }, opts.signal)).filter(isSaveable)
  const scored = scoreCandidates(place.title, candidates, opts.ctx, anchor)
  const good = scored
    .filter((s) => s.name >= ANCHOR_NAME_MATCH && s.proximity !== null && s.proximity > 0)
    .sort((a, b) => haversineKm(anchor, a.candidate) - haversineKm(anchor, b.candidate))
  const dist = (s: ScoredCandidate) => haversineKm(anchor, s.candidate)
  const only = good.length === 1
  // Branches of one name: take the nearest only when it is clearly the nearest.
  const clear = good.length > 1 && dist(good[0]!) <= ANCHOR_NEAR_KM && dist(good[1]!) >= 3 * Math.max(dist(good[0]!), 0.3)
  if ((only && dist(good[0]!) <= ANCHOR_SURE_KM) || clear) {
    const value = Math.round((only ? 0.9 + 0.08 * good[0]!.name : 0.86) * 1000) / 1000
    return { kind: 'commit', patch: geocoderPatch(good[0]!.candidate, value, true, scored, opts.geocoder.id) }
  }
  if (good.length) {
    // A lone match further out, or several branches: show the nearest and let the owner check.
    return { kind: 'commit', patch: geocoderPatch(good[0]!.candidate, only ? 0.7 : 0.6, false, good, opts.geocoder.id) }
  }
  return { kind: 'commit', patch: keep }
}

export async function resolvePlace(place: Place, opts: ResolveOptions): Promise<ResolveOutcome> {
  if (opts.places && place.googleFid) {
    const g = await opts.places.details(place.googleFid, opts.signal)
    if (g) return { kind: 'commit', patch: googlePatch(place, g) }
  }
  if (place.coordSource === 'fid' && place.lat !== undefined && place.lng !== undefined) {
    return resolveAnchored(place, { lat: place.lat, lng: place.lng }, opts)
  }
  const near = pickBias(opts.ctx)
  const candidates = await opts.geocoder.search({ text: place.title, near, limit: 5 }, opts.signal)
  const scored = scoreCandidates(place.title, candidates, opts.ctx)
  let result = confidence(scored)

  if (!opts.final && (!result || result.value <= ACCEPT_THRESHOLD)) return { kind: 'defer' }

  if (opts.final && result && result.value <= ACCEPT_THRESHOLD && scored.length > 1 && opts.disambiguate) {
    const llm = await opts.disambiguate(
      {
        title: place.title,
        hints: opts.ctx.hints,
        listNames: opts.listNames ?? [],
        clusterCities: opts.ctx.lists.flatMap((l) => l.clusters.map((c) => c.city)).filter((c): c is string => !!c),
        candidates: scored.map((s) => s.candidate),
      },
      opts.signal,
    )
    if (llm) result = confidence(scored, llm)
  }

  if (!result || result.value < REVIEW_THRESHOLD) {
    return {
      kind: 'commit',
      patch: {
        resolveStatus: 'review',
        resolveConfidence: result?.value ?? 0,
        resolveSource: opts.geocoder.id,
        resolveCandidates: toReviewCandidates(scored),
      },
    }
  }

  return {
    kind: 'commit',
    patch: geocoderPatch(scored[result.index]!.candidate, result.value, result.value > ACCEPT_THRESHOLD, scored, opts.geocoder.id),
  }
}
