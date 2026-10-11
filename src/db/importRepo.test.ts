import { beforeEach, describe, expect, it } from 'vitest'
import { buildSampleTakeoutZip } from '../dev/sampleTakeout'
import { freshDb } from '../test/db'
import type { HexploreDB } from './db'
import { importTakeout } from './importRepo'
import { setListRoles } from './listRepo'
import { exportBackup, restoreBackup } from './backup'

let db: HexploreDB
beforeEach(() => {
  db = freshDb()
})

const zip = (revision: 1 | 2) => [{ path: 'takeout.zip', data: buildSampleTakeoutZip({ count: 150, revision }) }]

describe('importTakeout', () => {
  it('writes places, lists, memberships, resolve jobs and an import record', async () => {
    const out = await importTakeout(zip(1), 1000)
    const [places, lists, ms, jobs, imports] = await Promise.all([
      db.places.count(),
      db.lists.toArray(),
      db.memberships.count(),
      db.jobs.where('[stage+status]').equals(['resolve', 'queued']).count(),
      db.imports.toArray(),
    ])
    expect(places).toBe(out.plan.counts.newPlaces)
    expect(lists).toHaveLength(7)
    expect(lists.every((l) => l.role === null)).toBe(true)
    expect(ms).toBe(out.plan.counts.newMemberships)
    expect(jobs).toBe(out.plan.counts.needsResolve)
    expect(jobs).toBeGreaterThan(0)
    expect(imports).toHaveLength(1)
  })

  it('re-importing the same export changes nothing', async () => {
    await importTakeout(zip(1), 1000)
    const again = await importTakeout(zip(1), 2000)
    expect(again.plan.counts).toMatchObject({ newPlaces: 0, updatedPlaces: 0, newMemberships: 0, removedMemberships: 0, skippedFiles: 7 })
  })

  it('a later export adds places, moves visited ones and keeps enrichment', async () => {
    await importTakeout(zip(1), 1000)
    const someId = (await db.places.limit(1).first())!.id
    await db.places.update(someId, { category: 'cafe', aiTags: ['quiet'] })

    const later = await importTakeout(zip(2), 2000)
    expect(later.plan.counts.newPlaces).toBeGreaterThan(0)
    expect(later.plan.counts.removedMemberships).toBeGreaterThan(0)
    expect(later.plan.counts.newMemberships).toBeGreaterThan(later.plan.counts.newPlaces)
    const kept = await db.places.get(someId)
    expect(kept).toMatchObject({ category: 'cafe', aiTags: ['quiet'], firstSeenAt: 1000 })
    const fresh = await db.places.where('firstSeenAt').equals(2000).count()
    expect(fresh).toBe(later.plan.counts.newPlaces)
  })
})

describe('backup', () => {
  it('round-trips data and never exports secrets', async () => {
    await importTakeout(zip(1), 1000)
    const lists = await db.lists.toArray()
    await setListRoles({ [lists[0]!.id]: 'visited' })
    await db.settings.put({ key: 'openRouterKey', value: 'sk-secret' })
    await db.settings.put({ key: 'geocoder', value: 'photon' })

    const backup = await exportBackup()
    expect(JSON.stringify(backup)).not.toContain('sk-secret')

    const placeCount = await db.places.count()
    await db.places.clear()
    await restoreBackup(JSON.parse(JSON.stringify(backup)))
    expect(await db.places.count()).toBe(placeCount)
    expect((await db.lists.get(lists[0]!.id))!.role).toBe('visited')
    expect((await db.settings.get('openRouterKey'))!.value).toBe('sk-secret')
  })

  it('rejects files that are not backups', async () => {
    await expect(restoreBackup({ hello: 1 })).rejects.toThrow(/Not a Hexplore backup/)
    await expect(restoreBackup({ format: 'hexplore-backup', version: 99, stores: {} })).rejects.toThrow(/newer/)
  })
})
