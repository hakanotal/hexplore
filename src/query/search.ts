import MiniSearch from 'minisearch'
import type { SearchDoc } from './searchDocs'

export type { SearchDoc }

// Fuzzy text search over title, notes, tags and area names. Built and queried
// inside the search worker so typing never blocks the map.

function fold(term: string): string {
  return term.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').toLowerCase()
}

export function createIndex(docs: SearchDoc[]): MiniSearch<SearchDoc> {
  const index = new MiniSearch<SearchDoc>({
    fields: ['title', 'text'],
    storeFields: [],
    processTerm: (term) => fold(term),
    searchOptions: { boost: { title: 3 }, prefix: true, fuzzy: 0.2, combineWith: 'AND' },
  })
  index.addAll(docs)
  return index
}

/** Returns id -> relevance score. */
export function search(index: MiniSearch<SearchDoc>, query: string, limit = 2000): Map<string, number> {
  const q = query.trim()
  if (!q) return new Map()
  return new Map(
    index
      .search(q)
      .slice(0, limit)
      .map((r) => [String(r.id), r.score]),
  )
}
