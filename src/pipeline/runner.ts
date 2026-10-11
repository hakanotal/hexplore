import type { HexploreDB } from '../db/db'
import { enqueueJobs } from '../db/jobs'
import type { Job, Membership, Place, StageName } from '../domain/types'
import type { Geocoder, ReverseGeocoder } from '../services/geocoder'
import { assignArea, classifyPlace } from './enrich'
import { computeListClusters, resolvePlace, type Disambiguator, type ListGeo, type ResolveContext } from './resolve'

// Resumable job queue over IndexedDB. Each stage records its own status per
// place, so a failed or rate-limited call retries with backoff without redoing
// earlier stages, and closing the tab mid-run loses nothing.

export const MAX_ATTEMPTS = 5

export interface PipelineServices {
  geocoder: Geocoder
  reverse: ReverseGeocoder
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

/** Creates jobs that should exist but don't, e.g. after a backup restore. */
export async function healQueue(db: HexploreDB, now: number): Promise<void> {
  const [places, jobs] = await Promise.all([db.places.toArray(), db.jobs.toArray()])
  const has = new Set(jobs.map((j) => j.id))
  const area: string[] = []
  const classify: string[] = []
  const resolve: string[] = []
  for (const p of places) {
    if (p.resolveStatus === 'pending' && !has.has(`resolve:${p.id}`)) resolve.push(p.id)
    if (p.lat !== undefined && !p.city && !has.has(`area:${p.id}`)) area.push(p.id)
    if (p.osmTags && !p.category && !has.has(`classify:${p.id}`)) classify.push(p.id)
  }
  await db.jobs.bulkPut([...enqueueJobs('resolve', resolve, now), ...enqueueJobs('area', area, now), ...enqueueJobs('classify', classify, now)])
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

  await healQueue(db, now())

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
              const next = outcome.patch.city ? 'classify' : 'area'
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
