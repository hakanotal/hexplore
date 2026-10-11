import type { ListRole } from '../domain/types'
import { getDb } from './db'

export async function setListRoles(roles: Record<string, ListRole>): Promise<void> {
  const db = getDb()
  await db.transaction('rw', db.lists, async () => {
    for (const [id, role] of Object.entries(roles)) await db.lists.update(id, { role })
  })
}
