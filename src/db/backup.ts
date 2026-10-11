import type { ImportRecord, List, Membership, Place, SavedView, Setting, UserData } from '../domain/types'
import { getDb } from './db'

// One versioned JSON file with every store except embeddings (cheap to rebuild),
// jobs and the HTTP cache. Secrets in settings are never exported.

export const BACKUP_FORMAT = 'hexplore-backup'
export const BACKUP_VERSION = 1
const SECRET_SETTINGS = new Set(['openRouterKey', 'orsKey'])

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  stores: {
    places: Place[]
    lists: List[]
    memberships: Membership[]
    userData: UserData[]
    imports: ImportRecord[]
    savedViews: SavedView[]
    settings: Setting[]
  }
}

export async function exportBackup(): Promise<Backup> {
  const db = getDb()
  const [places, lists, memberships, userData, imports, savedViews, settings] = await Promise.all([
    db.places.toArray(),
    db.lists.toArray(),
    db.memberships.toArray(),
    db.userData.toArray(),
    db.imports.toArray(),
    db.savedViews.toArray(),
    db.settings.toArray(),
  ])
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    stores: {
      places,
      lists,
      memberships,
      userData,
      imports,
      savedViews,
      settings: settings.filter((s) => !SECRET_SETTINGS.has(s.key)),
    },
  }
}

export function validateBackup(json: unknown): Backup {
  const b = json as Partial<Backup> | null
  if (!b || b.format !== BACKUP_FORMAT) throw new Error('Not a Hexplore backup file')
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new Error(`Backup version ${String(b.version)} is newer than this app supports (${BACKUP_VERSION})`)
  }
  const s = b.stores
  if (!s || !Array.isArray(s.places) || !Array.isArray(s.lists) || !Array.isArray(s.memberships)) {
    throw new Error('Backup is missing required stores')
  }
  return b as Backup
}

/** Replaces all data with the backup contents. Secrets already on the device are kept. */
export async function restoreBackup(json: unknown): Promise<void> {
  const backup = validateBackup(json)
  const db = getDb()
  const s = backup.stores
  await db.transaction(
    'rw',
    [db.places, db.lists, db.memberships, db.userData, db.imports, db.savedViews, db.settings, db.embeddings, db.jobs],
    async () => {
      const keptSecrets = (await db.settings.toArray()).filter((x) => SECRET_SETTINGS.has(x.key))
      await Promise.all([
        db.places.clear(),
        db.lists.clear(),
        db.memberships.clear(),
        db.userData.clear(),
        db.imports.clear(),
        db.savedViews.clear(),
        db.settings.clear(),
        db.embeddings.clear(),
        db.jobs.clear(),
      ])
      await db.places.bulkPut(s.places)
      await db.lists.bulkPut(s.lists)
      await db.memberships.bulkPut(s.memberships)
      await db.userData.bulkPut(s.userData ?? [])
      await db.imports.bulkPut(s.imports ?? [])
      await db.savedViews.bulkPut(s.savedViews ?? [])
      await db.settings.bulkPut([...(s.settings ?? []).filter((x) => !SECRET_SETTINGS.has(x.key)), ...keptSecrets])
    },
  )
}

export function backupFileName(date = new Date()): string {
  return `hexplore-backup-${date.toISOString().slice(0, 10)}.json`
}
