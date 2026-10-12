import { useState } from 'react'
import { TAXONOMY, categoryLabel } from '../domain/taxonomy'
import { activeFilterCount, type Facet, type StatusValue } from '../query/filters'
import { useApp } from '../state/store'

const STATUS_LABEL: Record<StatusValue, string> = { visited: 'Visited', wantToGo: 'Want to go', saved: 'Saved, other' }
const TOP_N = 12

export function FilterPanel({ onClose }: { onClose: () => void }) {
  const filters = useApp((s) => s.filters)
  const counts = useApp((s) => s.counts)
  const lists = useApp((s) => s.lists)
  const total = useApp((s) => s.result.length)
  const toggle = useApp((s) => s.toggleFacet)
  const setFilters = useApp((s) => s.setFilters)
  const clear = useApp((s) => s.clearFilters)

  const options = (facet: Facet, order?: string[]): [string, number][] => {
    const map = counts[facet]
    const selected = filters[facet] as string[]
    const keys = new Set([...map.keys(), ...selected])
    const arr = [...keys].map((k) => [k, map.get(k) ?? 0] as [string, number])
    if (order) arr.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    else arr.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    return arr
  }

  const catOrder = [...TAXONOMY.map((c) => c.id), 'uncategorized']

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex flex-col bg-white dark:bg-slate-900" role="dialog" aria-label="Filters">
      <header className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-4 py-3">
        <button onClick={clear} className="text-[15px] text-blue-700 dark:text-blue-400">Clear all</button>
        <h2 className="text-[17px] font-semibold">Filters</h2>
        <button onClick={onClose} className="text-[15px] font-medium text-slate-700 dark:text-slate-300">Done</button>
      </header>
      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        <SavedViews />
        <Group title="Status">
          {options('status', ['visited', 'wantToGo', 'saved']).map(([k, n]) => (
            <Chip key={k} active={filters.status.includes(k as StatusValue)} count={n} onClick={() => toggle('status', k)}>
              {STATUS_LABEL[k as StatusValue] ?? k}
            </Chip>
          ))}
        </Group>
        <Group title="Category">
          {options('categories', catOrder).map(([k, n]) => (
            <Chip key={k} active={filters.categories.includes(k)} count={n} onClick={() => toggle('categories', k)}>
              {k === 'uncategorized' ? 'Uncategorized' : categoryLabel(k)}
            </Chip>
          ))}
        </Group>
        <Group title="List">
          {lists.map((l) => (
            <Chip key={l.id} active={filters.lists.includes(l.id)} count={counts.lists.get(l.id) ?? 0} onClick={() => toggle('lists', l.id)}>
              {l.name}
            </Chip>
          ))}
        </Group>
        <FacetGroup title="Country" facet="countries" options={options('countries')} />
        <FacetGroup title="City" facet="cities" options={options('cities')} />
        <FacetGroup title="Neighborhood" facet="neighborhoods" options={options('neighborhoods')} />
        <FacetGroup title="Tags" facet="tags" options={options('tags')} />
        <Group title="More">
          <Chip active={filters.hasNotes} onClick={() => setFilters({ hasNotes: !filters.hasNotes })}>Has notes</Chip>
          <Chip active={filters.needsReview} onClick={() => setFilters({ needsReview: !filters.needsReview })}>Location needs a check</Chip>
        </Group>
        <Group title="First seen">
          <label className="flex items-center gap-2 text-[14px] text-slate-600 dark:text-slate-400">
            From
            <input type="date" value={filters.seenFrom ?? ''} onChange={(e) => setFilters({ seenFrom: e.target.value || undefined })} className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1" />
          </label>
          <label className="flex items-center gap-2 text-[14px] text-slate-600 dark:text-slate-400">
            To
            <input type="date" value={filters.seenTo ?? ''} onChange={(e) => setFilters({ seenTo: e.target.value || undefined })} className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1" />
          </label>
        </Group>
      </div>
      <footer className="border-t border-slate-200 dark:border-slate-700 p-3">
        <button onClick={onClose} className="w-full rounded-xl bg-slate-900 dark:bg-slate-100 dark:text-slate-900 py-3 text-[16px] font-semibold text-white" data-testid="show-results">
          Show {total.toLocaleString()} {total === 1 ? 'place' : 'places'}
        </button>
      </footer>
    </div>
  )
}

function SavedViews() {
  const views = useApp((s) => s.savedViews)
  const canSave = useApp((s) => activeFilterCount(s.filters) > 0)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  if (!views.length && !canSave) return null

  const save = async () => {
    if (!name.trim()) return
    await useApp.getState().saveCurrentView(name)
    setName('')
    setNaming(false)
  }

  return (
    <Group title="Saved views">
      {views.map((v) => (
        <span key={v.id} className="inline-flex items-center rounded-full bg-white dark:bg-slate-900 ring-1 ring-slate-300 dark:ring-slate-600">
          <button onClick={() => useApp.getState().applyView(v)} className="py-1.5 pl-3 pr-1 text-[14px] text-slate-800 dark:text-slate-200">
            {v.name}
          </button>
          <button onClick={() => void useApp.getState().removeView(v.id)} className="px-2 py-1.5 text-[13px] text-slate-400 dark:text-slate-500" aria-label={`Delete view ${v.name}`}>
            ✕
          </button>
        </span>
      ))}
      {canSave && !naming && (
        <button onClick={() => setNaming(true)} className="rounded-full px-3 py-1.5 text-[14px] text-blue-700 dark:text-blue-400 ring-1 ring-blue-200 dark:ring-blue-900">
          Save current filters
        </button>
      )}
      {naming && (
        <form
          className="flex w-full gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Lisbon food, not visited"
            aria-label="View name"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-[14px]"
          />
          <button type="submit" disabled={!name.trim()} className="rounded-lg bg-slate-900 dark:bg-slate-100 dark:text-slate-900 px-3 py-1.5 text-[14px] font-medium text-white disabled:opacity-40">
            Save
          </button>
        </form>
      )}
    </Group>
  )
}

function FacetGroup({ title, facet, options }: { title: string; facet: Facet; options: [string, number][] }) {
  const selected = useApp((s) => s.filters[facet] as string[])
  const toggle = useApp((s) => s.toggleFacet)
  if (!options.length) return null
  const shown = options.filter(([k], i) => i < TOP_N || selected.includes(k))
  return (
    <Group title={title}>
      {shown.map(([k, n]) => (
        <Chip key={k} active={selected.includes(k)} count={n} onClick={() => toggle(facet, k)}>
          {k}
        </Chip>
      ))}
    </Group>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  )
}

function Chip({ active, count, onClick, children }: { active: boolean; count?: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      disabled={!active && count === 0}
      className={`rounded-full px-3 py-1.5 text-[14px] ring-1 transition-colors disabled:opacity-40 ${
        active ? 'bg-slate-900 dark:bg-slate-100 dark:text-slate-900 text-white ring-slate-900 dark:ring-slate-100' : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 ring-slate-300 dark:ring-slate-600'
      }`}
    >
      {children}
      {count !== undefined && ' '}
      {count !== undefined && <span className={`ml-1 tabular-nums ${active ? 'text-slate-300 dark:text-slate-600' : 'text-slate-400 dark:text-slate-500'}`}>{count.toLocaleString()}</span>}
    </button>
  )
}
