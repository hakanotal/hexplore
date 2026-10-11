import type { Membership, Place, ResolveCandidate } from '../domain/types'
import type { GeoCandidate, Geocoder } from '../services/geocoder'
import { haversineKm, nameSimilarity, normalizeName } from './similarity'

// Stage 1: turn a title into coordinates. Places in one list cluster
// geographically, so confident matches are resolved first, each list's
// clusters are computed from them, and ambiguous searches are then scored
// against those clusters.

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

export function scoreCandidates(title: string, candidates: GeoCandidate[], ctx: ResolveContext): ScoredCandidate[] {
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

export async function resolvePlace(place: Place, opts: ResolveOptions): Promise<ResolveOutcome> {
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

  const chosen = scored[result.index]!.candidate
  const accepted = result.value > ACCEPT_THRESHOLD
  return {
    kind: 'commit',
    patch: {
      ...candidatePatch(chosen),
      coordSource: 'geocoder',
      resolveStatus: accepted ? 'resolved' : 'flagged',
      resolveConfidence: result.value,
      resolveSource: opts.geocoder.id,
      resolveCandidates: accepted ? undefined : toReviewCandidates(scored),
    },
  }
}
