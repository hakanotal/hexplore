import type { ResolveCandidate, UserData } from '../domain/types'
import { enqueueJobs } from './jobs'
import { getDb } from './db'

// User edits. They live in userData (never touched by import) or set the
// place's resolution to manual.

async function getUserData(placeId: string): Promise<UserData> {
  return (await getDb().userData.get(placeId)) ?? { placeId, userTags: [], visits: [] }
}

export async function logVisit(placeId: string, date = Date.now()): Promise<void> {
  const u = await getUserData(placeId)
  await getDb().userData.put({ ...u, visits: [...u.visits, { date }] })
}

export async function removeLastVisit(placeId: string): Promise<void> {
  const u = await getUserData(placeId)
  await getDb().userData.put({ ...u, visits: u.visits.slice(0, -1) })
}

export async function setUserTags(placeId: string, tags: string[]): Promise<void> {
  const u = await getUserData(placeId)
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))]
  await getDb().userData.put({ ...u, userTags: clean })
}

export async function setUserNote(placeId: string, note: string): Promise<void> {
  const u = await getUserData(placeId)
  await getDb().userData.put({ ...u, userNote: note.trim() || undefined })
}

/** Accepts one of the geocoder candidates from the review queue. */
export async function chooseCandidate(placeId: string, c: ResolveCandidate): Promise<void> {
  const db = getDb()
  await db.transaction('rw', db.places, db.jobs, async () => {
    await db.places.update(placeId, {
      lat: c.lat,
      lng: c.lng,
      osmId: c.osmId,
      address: c.address,
      coordSource: 'manual',
      resolveStatus: 'manual',
      resolveConfidence: 1,
      resolveCandidates: undefined,
      // Area and category came from the old candidate; recompute them.
      city: undefined,
      neighborhood: undefined,
      region: undefined,
      country: undefined,
      osmTags: undefined,
      updatedAt: Date.now(),
    })
    await db.jobs.bulkPut(enqueueJobs('area', [placeId]))
  })
}

/** "Fix location": a pin the user placed. */
export async function setManualLocation(placeId: string, lat: number, lng: number): Promise<void> {
  const db = getDb()
  await db.transaction('rw', db.places, db.jobs, async () => {
    await db.places.update(placeId, {
      lat,
      lng,
      coordSource: 'manual',
      resolveStatus: 'manual',
      resolveConfidence: 1,
      resolveCandidates: undefined,
      city: undefined,
      neighborhood: undefined,
      region: undefined,
      country: undefined,
      updatedAt: Date.now(),
    })
    await db.jobs.bulkPut(enqueueJobs('area', [placeId]))
  })
}

export async function confirmLocation(placeId: string): Promise<void> {
  await getDb().places.update(placeId, { resolveStatus: 'manual', resolveCandidates: undefined, updatedAt: Date.now() })
}
