import type { SavedView } from '../domain/types'
import { getDb } from './db'

// Saved views: a named filter combination, stored as the same query string the
// URL carries, so a view and a bookmark are interchangeable.

export async function listSavedViews(): Promise<SavedView[]> {
  return (await getDb().savedViews.toArray()).sort((a, b) => a.name.localeCompare(b.name))
}

/** Saving under a name that already exists (any case) replaces that view. */
export async function saveView(name: string, query: string, now = Date.now()): Promise<SavedView> {
  const db = getDb()
  const trimmed = name.trim()
  const existing = (await db.savedViews.toArray()).find((v) => v.name.toLowerCase() === trimmed.toLowerCase())
  const view: SavedView = {
    id: existing?.id ?? `v${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: trimmed,
    query,
    createdAt: existing?.createdAt ?? now,
  }
  await db.savedViews.put(view)
  return view
}

export async function deleteView(id: string): Promise<void> {
  await getDb().savedViews.delete(id)
}
