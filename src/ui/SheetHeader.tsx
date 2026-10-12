import { categoryLabel } from '../domain/taxonomy'
import type { Facet } from '../query/filters'
import { useApp, type SortMode } from '../state/store'

const SORT_LABEL: Record<SortMode, string> = { relevance: 'Best match', distance: 'Nearest', recent: 'Newest', name: 'A–Z' }

export function SheetHeader() {
  const total = useApp((s) => s.result.length)
  const all = useApp((s) => s.views.length)
  const filters = useApp((s) => s.filters)
  const listById = useApp((s) => s.listById)
  const sort = useApp((s) => s.sort)
  const hasQuery = useApp((s) => !!s.hits)
  const hasLocation = useApp((s) => !!s.userLocation)
  const toggle = useApp((s) => s.toggleFacet)
  const setFilters = useApp((s) => s.setFilters)
  const setSort = useApp((s) => s.setSort)
  const clear = useApp((s) => s.clearFilters)

  const chips: { key: string; label: string; remove: () => void }[] = []
  const facetLabel = (facet: Facet, v: string) =>
    facet === 'categories' ? (v === 'uncategorized' ? 'Uncategorized' : categoryLabel(v)) : facet === 'lists' ? (listById.get(v)?.name ?? v) : facet === 'status' ? ({ visited: 'Visited', wantToGo: 'Want to go', saved: 'Other saved' } as Record<string, string>)[v] ?? v : v
  for (const facet of ['status', 'categories', 'lists', 'countries', 'cities', 'neighborhoods', 'tags'] as Facet[]) {
    for (const v of filters[facet] as string[]) chips.push({ key: `${facet}:${v}`, label: facetLabel(facet, v), remove: () => toggle(facet, v) })
  }
  if (filters.hasNotes) chips.push({ key: 'notes', label: 'Has notes', remove: () => setFilters({ hasNotes: false }) })
  if (filters.needsReview) chips.push({ key: 'review', label: 'Needs a check', remove: () => setFilters({ needsReview: false }) })
  if (filters.openNow) chips.push({ key: 'open', label: 'Open now', remove: () => setFilters({ openNow: false }) })
  if (filters.bbox) chips.push({ key: 'bbox', label: 'This area', remove: () => setFilters({ bbox: undefined }) })
  if (filters.near) chips.push({ key: 'near', label: `Within ${filters.near.km < 1 ? `${filters.near.km * 1000} m` : `${filters.near.km} km`}`, remove: () => setFilters({ near: undefined }) })
  if (filters.seenFrom || filters.seenTo) chips.push({ key: 'seen', label: 'First seen range', remove: () => setFilters({ seenFrom: undefined, seenTo: undefined }) })

  const sorts: SortMode[] = [...(hasQuery ? (['relevance'] as const) : []), ...(hasLocation ? (['distance'] as const) : []), 'recent', 'name']

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100" data-testid="result-count">
          {total.toLocaleString()} {total === 1 ? 'place' : 'places'}
          {total !== all && <span className="font-normal text-slate-500 dark:text-slate-400"> of {all.toLocaleString()}</span>}
        </p>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
          onPointerDown={(e) => e.stopPropagation()}
          className="rounded-md bg-transparent text-[13px] text-slate-600 dark:text-slate-400"
          aria-label="Sort"
        >
          {sorts.map((s) => (
            <option key={s} value={s}>
              {SORT_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      {chips.length > 0 && (
        <div className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto pb-1" onPointerDown={(e) => e.stopPropagation()}>
          {chips.map((c) => (
            <button key={c.key} onClick={c.remove} className="shrink-0 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-[13px] text-slate-700 dark:text-slate-300">
              {c.label} ✕
            </button>
          ))}
          {chips.length > 1 && (
            <button onClick={clear} className="shrink-0 px-2 py-1 text-[13px] text-blue-700 dark:text-blue-400">
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}
