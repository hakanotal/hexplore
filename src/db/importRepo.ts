import type { ImportRecord } from '../domain/types'
import { planImport, type ExistingState, type ImportPlan } from '../import/merge'
import { readTakeout, type InputFile } from '../import/takeout'
import { getDb } from './db'
import { enqueueJobs } from './jobs'

export interface ImportOutcome {
  importId: number
  plan: Omit<ImportPlan, 'putPlaces' | 'putLists' | 'putMemberships'>
  ignored: string[]
}

async function loadExisting(placeIds: string[], listIds: string[]): Promise<ExistingState> {
  const db = getDb()
  const [places, lists, memberships, lastImport] = await Promise.all([
    db.places.bulkGet(placeIds),
    db.lists.toArray(),
    db.memberships.where('listId').anyOf(listIds).toArray(),
    db.imports.orderBy('date').last(),
  ])
  return {
    places: new Map(places.filter((p) => p !== undefined).map((p) => [p.id, p])),
    lists: new Map(lists.map((l) => [l.id, l])),
    memberships,
    lastFileHashes: lastImport?.fileHashes ?? {},
  }
}

/** Parses, merges and writes a Takeout export in one transaction. */
export async function importTakeout(files: InputFile[], now = Date.now()): Promise<ImportOutcome> {
  const parsed = await readTakeout(files)
  const placeIds = [...new Set(parsed.lists.flatMap((l) => l.rows.map((r) => r.placeId)))]
  const listIds = [...new Set(parsed.lists.map((l) => l.listId))]
  const existing = await loadExisting(placeIds, listIds)
  const plan = planImport(parsed, existing, now)

  const db = getDb()
  const record: ImportRecord = { date: now, fileHashes: plan.fileHashes, counts: plan.counts, warnings: plan.warnings }
  const importId = await db.transaction('rw', [db.places, db.lists, db.memberships, db.imports, db.jobs], async () => {
    await db.places.bulkPut(plan.putPlaces)
    await db.lists.bulkPut(plan.putLists)
    await db.memberships.bulkPut(plan.putMemberships)
    await db.jobs.bulkPut(enqueueJobs('resolve', plan.resolveIds, now))
    return (await db.imports.add(record)) as number
  })

  const { putPlaces: _p, putLists: _l, putMemberships: _m, ...summary } = plan
  return { importId, plan: summary, ignored: parsed.ignored }
}
