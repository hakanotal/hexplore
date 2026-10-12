import type { HexploreDB } from '../db/db'
import { enqueueJobs } from '../db/jobs'
import type { Job, Membership, Place, StageName } from '../domain/types'
import type { Geocoder, ReverseGeocoder } from '../services/geocoder'
import type { PlaceDetailsService } from '../services/googlePlaces'
import type { PoiFinder } from '../services/overpass'
import { assignArea, classifyPlace } from './enrich'
import { bestPoi, MATCH_RADIUS_M, matchPatch } from './match'
import { computeListClusters, resolvePlace, type Disambiguator, type ListGeo, type ResolveContext } from './resolve'

// Resumable job queue over IndexedDB. Each stage records its own status per
// place, so a failed or rate-limited call retries with backoff without redoing
// earlier stages, and closing the tab mid-run loses nothing.

export const MAX_ATTEMPTS = 5

export interface PipelineServices {
  geocoder: Geocoder
  reverse: ReverseGeocoder
  /** Google Place Details, when a key is configured. */
  places?: PlaceDetailsService
  /** OSM features near located places (Overpass); without it the match stage is skipped. */
  pois?: PoiFinder
  disambiguate?: Disambiguator
}

export interface PipelineProgress {
  stage: StageName | 'idle'
  done: number
  total: number
  resolved: number
  flagged: number
  review: number
  errors: number
}

export interface RunOptions {
  onProgress?: (p: PipelineProgress) => void
  signal?: AbortSignal
  now?: () => number
}

function backoffMs(attempts: number): number {
  return Math.min(60_000 * 30, 2000 * 2 ** attempts)
}

async function failJob(db: HexploreDB, job: Job, err: unknown, now: number) {
  const attempts = job.attempts + 1
  await db.jobs.put({
    ...job,
    attempts,
    status: attempts >= MAX_ATTEMPTS ? 'error' : 'queued',
    notBefore: now + backoffMs(attempts),
    error: err instanceof Error ? err.message : String(err),
    updatedAt: now,
  })
}

async function readyJobs(db: HexploreDB, stage: StageName, now: number): Promise<Job[]> {
  const jobs = await db.jobs.where('[stage+status]').equals([stage, 'queued']).toArray()
  return jobs.filter((j) => j.notBefore <= now)
}

/**
 * Creates jobs that should exist but don't, e.g. after a backup restore or
 * when a stage is added: places located before the match stage existed get
 * matched once.
 */
export async function healQueue(db: HexploreDB, now: number, opts: { match: boolean } = { match: false }): Promise<void> {
  const [places, jobs] = await Promise.all([db.places.toArray(), db.jobs.toArray()])
  const has = new Set(jobs.map((j) => j.id))
  const area: string[] = []
  const classify: string[] = []
  const resolve: string[] = []
  const match: string[] = []
  for (const p of places) {
    if (p.resolveStatus === 'pending') {
      if (!has.has(`resolve:${p.id}`)) resolve.push(p.id)
      // Pending places with a feature ID point are matched and get their area after resolve.
      continue
    }
    if (p.lat === undefined) continue
    const needsMatch = opts.match && p.matchCheckedAt === undefined
    if (needsMatch && !has.has(`match:${p.id}`)) match.push(p.id)
    if (!needsMatch && !p.city && !has.has(`area:${p.id}`)) area.push(p.id)
  }
  for (const p of places) if ((p.osmTags || p.googleTypes?.length) && !p.category && !has.has(`classify:${p.id}`)) classify.push(p.id)
  await db.jobs.bulkPut([
    ...enqueueJobs('resolve', resolve, now),
    ...enqueueJobs('match', match, now),
    ...enqueueJobs('area', area, now),
    ...enqueueJobs('classify', classify, now),
  ])
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function buildContext(place: Place, membershipsByPlace: Map<string, Membership[]>, geo: Map<string, ListGeo>): ResolveContext {
  const ms = (membershipsByPlace.get(place.id) ?? []).filter((m) => m.removedAt === undefined)
  return {
    lists: ms.map((m) => geo.get(m.listId)).filter((g): g is ListGeo => !!g),
    hints: ms.flatMap((m) => [m.note, m.comment]).filter((x): x is string => !!x),
  }
}

export async function runPipeline(db: HexploreDB, services: PipelineServices, opts: RunOptions = {}): Promise<PipelineProgress> {
  const now = opts.now ?? Date.now
  const progress: PipelineProgress = { stage: 'idle', done: 0, total: 0, resolved: 0, flagged: 0, review: 0, errors: 0 }
  const report = () => opts.onProgress?.({ ...progress })
  const signal = opts.signal

  await healQueue(db, now(), { match: !!services.pois })

  // ---- Stage 1: resolve ----------------------------------------------------
  const resolveJobs = await readyJobs(db, 'resolve', now())
  if (resolveJobs.length) {
    progress.stage = 'resolve'
    progress.done = 0
    progress.total = resolveJobs.length
    report()

    const [memberships, lists] = await Promise.all([db.memberships.toArray(), db.lists.toArray()])
    const listNames = new Map(lists.map((l) => [l.id, l.name]))
    const membershipsByPlace = new Map<string, Membership[]>()
    for (const m of memberships) {
      const arr = membershipsByPlace.get(m.placeId)
      if (arr) arr.push(m)
      else membershipsByPlace.set(m.placeId, [m])
    }

    const deferred: Job[] = []
    for (const final of [false, true]) {
      const queue = final ? deferred : resolveJobs
      if (final && !queue.length) break
      // Clusters come from everything located so far, including pass one.
      const clusters = computeListClusters(await db.places.toArray(), memberships)
      for (const job of queue) {
        signal?.throwIfAborted()
        const place = await db.places.get(job.placeId)
        if (!place || place.resolveStatus !== 'pending') {
          await db.jobs.update(job.id, { status: 'done', updatedAt: now() })
          progress.done++
          continue
        }
        try {
          const outcome = await resolvePlace(place, {
            geocoder: services.geocoder,
            places: services.places,
            ctx: buildContext(place, membershipsByPlace, clusters),
            final,
            listNames: (membershipsByPlace.get(place.id) ?? []).map((m) => listNames.get(m.listId) ?? ''),
            disambiguate: services.disambiguate,
            signal,
          })
          if (outcome.kind === 'defer') {
            deferred.push(job)
            continue
          }
          const status = outcome.patch.resolveStatus
          await db.transaction('rw', db.places, db.jobs, async () => {
            await db.places.update(place.id, { ...outcome.patch, updatedAt: now() })
            await db.jobs.update(job.id, { status: 'done', attempts: job.attempts + 1, error: undefined, updatedAt: now() })
            if (status === 'resolved' || status === 'flagged') {
              const next = services.pois ? 'match' : outcome.patch.city ? 'classify' : 'area'
              await db.jobs.bulkPut(enqueueJobs(next, [place.id], now()))
            }
          })
          if (status === 'resolved') progress.resolved++
          else if (status === 'flagged') progress.flagged++
          else progress.review++
        } catch (err) {
          if (signal?.aborted) throw err
          await failJob(db, job, err, now())
          progress.errors++
        }
        progress.done++
        report()
      }
    }
  }

  // ---- Stage 2: match (OSM tags: opening hours, website, cuisine) ---------
  const matchJobs = await readyJobs(db, 'match', now())
  if (matchJobs.length) {
    progress.stage = 'match'
    progress.done = 0
    progress.total = matchJobs.length
    report()
    const places = await db.places.bulkGet(matchJobs.map((j) => j.placeId))
    // One Overpass query per city-sized area (~20 km cells), at most 40 places each.
    // Cost is per around() search, not per area, so bigger cells only mean fewer requests.
    const cells = new Map<string, { job: Job; place: Place }[]>()
    const skip: Job[] = []
    matchJobs.forEach((job, i) => {
      const place = places[i]
      if (!place || place.lat === undefined || place.lng === undefined) return skip.push(job)
      const key = `${Math.floor(place.lat / 0.2)}:${Math.floor(place.lng / 0.2)}`
      const cell = cells.get(key)
      if (cell) cell.push({ job, place })
      else cells.set(key, [{ job, place }])
    })
    for (const job of skip) {
      await db.jobs.update(job.id, { status: 'done', updatedAt: now() })
      progress.done++
    }
    for (const batch of [...cells.values()].flatMap((c) => chunks(c, 40))) {
      signal?.throwIfAborted()
      try {
        // Without a POI service, leftover jobs just move on; the places stay unchecked for a later run.
        const pois = services.pois ? await services.pois.poisNear(batch.map((b) => ({ lat: b.place.lat!, lng: b.place.lng! })), MATCH_RADIUS_M, signal) : null
        await db.transaction('rw', db.places, db.jobs, async () => {
          for (const { job, place } of batch) {
            const poi = pois && bestPoi(place, pois)
            if (pois) await db.places.update(place.id, { ...(poi ? matchPatch(poi) : {}), matchCheckedAt: now(), updatedAt: now() })
            await db.jobs.update(job.id, { status: 'done', attempts: job.attempts + 1, error: undefined, updatedAt: now() })
            await db.jobs.bulkPut(enqueueJobs(place.city ? 'classify' : 'area', [place.id], now()))
          }
        })
      } catch (err) {
        if (signal?.aborted) throw err
        for (const { job } of batch) await failJob(db, job, err, now())
        progress.errors += batch.length
      }
      progress.done += batch.length
      report()
    }
  }

  // ---- Stage 4: area (places that came with coordinates) -------------------
  const areaJobs = await readyJobs(db, 'area', now())
  if (areaJobs.length) {
    progress.stage = 'area'
    progress.done = 0
    progress.total = areaJobs.length
    report()
    for (const job of areaJobs) {
      signal?.throwIfAborted()
      const place = await db.places.get(job.placeId)
      try {
        const patch = place ? await assignArea(place, services.reverse, signal) : {}
        await db.transaction('rw', db.places, db.jobs, async () => {
          if (place) await db.places.update(place.id, { ...patch, updatedAt: now() })
          await db.jobs.update(job.id, { status: 'done', attempts: job.attempts + 1, error: undefined, updatedAt: now() })
          if (place) await db.jobs.bulkPut(enqueueJobs('classify', [place.id], now()))
        })
      } catch (err) {
        if (signal?.aborted) throw err
        await failJob(db, job, err, now())
        progress.errors++
      }
      progress.done++
      report()
    }
  }

  // ---- Stage 3: classify (rules; the LLM classifier picks up the rest) -----
  const classifyJobs = await readyJobs(db, 'classify', now())
  if (classifyJobs.length) {
    progress.stage = 'classify'
    progress.done = 0
    progress.total = classifyJobs.length
    report()
    const places = await db.places.bulkGet(classifyJobs.map((j) => j.placeId))
    await db.transaction('rw', db.places, db.jobs, async () => {
      for (const [i, job] of classifyJobs.entries()) {
        const place = places[i]
        if (place) {
          const { patch, needsModel } = classifyPlace(place)
          await db.places.update(place.id, { ...patch, updatedAt: now() })
          await db.jobs.update(job.id, {
            status: 'done',
            attempts: job.attempts + 1,
            error: needsModel ? 'No rule matched; waiting for the LLM classifier' : undefined,
            updatedAt: now(),
          })
        } else {
          await db.jobs.update(job.id, { status: 'done', updatedAt: now() })
        }
        progress.done++
      }
    })
    report()
  }

  progress.stage = 'idle'
  report()
  return progress
}
