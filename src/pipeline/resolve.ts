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
// the exact place. Without one (or past the monthly budget) that point
// outweighs any list context: the search only has to find the matching POI
// next to it, and when none matches Google's own point is kept.

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

/** Candidates this close to the feature ID point count as on top of it. */
const ANCHOR_RADIUS_KM = 0.25
const ANCHOR_DECAY_KM = 1
const ANCHOR_WEIGHT = 0.5
/** Name similarity at which a distant candidate is worth showing the user. */
const ANCHOR_NAME_MATCH = 0.85
/** Confidence in Google's point when no candidate matched near it. */
export const FID_CONFIDENCE = 0.9
/** Confidence when a same-named candidate elsewhere contests Google's point. */
const FID_CONTESTED_CONFIDENCE = 0.6

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
      const proximity = d <= ANCHOR_RADIUS_KM ? 1 : Math.exp(-(d - ANCHOR_RADIUS_KM) / ANCHOR_DECAY_KM)
      return { candidate, name, proximity, score: (1 - ANCHOR_WEIGHT) * name + ANCHOR_WEIGHT * proximity }
    })
    .sort((a, b) => b.score - a.score)
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
  const keep: Partial<Place> = {
    coordSource: 'fid',
    resolveStatus: 'resolved',
    resolveConfidence: FID_CONFIDENCE,
    resolveSource: 'fid',
    resolveCandidates: undefined,
  }
  if (place.title === UNTITLED_PLACE) return { kind: 'commit', patch: keep }

  const candidates = await opts.geocoder.search({ text: place.title, near: anchor, limit: 5 }, opts.signal)
  const scored = scoreCandidates(place.title, candidates, opts.ctx, anchor)
  const result = confidence(scored)
  if (result && result.value > ACCEPT_THRESHOLD) {
    return { kind: 'commit', patch: geocoderPatch(scored[result.index]!.candidate, result.value, true, scored, opts.geocoder.id) }
  }
  // The right name away from Google's point: Google moved the pin after the ID
  // was made, or it is another branch. Keep Google's point and offer the match.
  if (scored[0] && scored[0].name >= ANCHOR_NAME_MATCH) {
    return {
      kind: 'commit',
      patch: { ...keep, resolveStatus: 'flagged', resolveConfidence: FID_CONTESTED_CONFIDENCE, resolveCandidates: toReviewCandidates(scored) },
    }
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
