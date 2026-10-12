import { useEffect, useState } from 'react'
import { activeFilterCount } from '../query/filters'
import { useApp } from '../state/store'
import { navigate } from './router'

export function SearchBar({ onOpenFilters }: { onOpenFilters: () => void }) {
  const q = useApp((s) => s.filters.q)
  const setQuery = useApp((s) => s.setQuery)
  const filterCount = useApp((s) => activeFilterCount(s.filters) - (s.filters.q ? 1 : 0))
  const [text, setText] = useState(q)
  const [menu, setMenu] = useState(false)
  const reviewCount = useApp((s) => s.views.reduce((n, v) => n + (v.needsReview ? 1 : 0), 0))

  // Follow the store when the query changes elsewhere (clear filters, URL).
  const [prevQ, setPrevQ] = useState(q)
  if (q !== prevQ) {
    setPrevQ(q)
    setText(q)
  }
  useEffect(() => {
    if (text === q) return
    const t = setTimeout(() => setQuery(text), 120)
    return () => clearTimeout(t)
  }, [text, q, setQuery])

  return (
    <div className="pointer-events-auto absolute inset-x-3 top-3 z-20 flex items-center gap-2">
      <div className="flex flex-1 items-center rounded-full bg-white px-4 shadow-md ring-1 ring-slate-200">
        <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.47 9.77l3.63 3.63a.75.75 0 1 0 1.06-1.06l-3.63-3.63A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clipRule="evenodd" />
        </svg>
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search your places"
          aria-label="Search your places"
          className="h-11 w-full bg-transparent px-2 text-[15px] text-slate-900 outline-none placeholder:text-slate-400"
        />
      </div>
      <button
        onClick={onOpenFilters}
        className="relative grid h-11 w-11 place-items-center rounded-full bg-white shadow-md ring-1 ring-slate-200"
        aria-label="Filters"
      >
        <svg className="h-5 w-5 text-slate-700" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path d="M3 5.25A.75.75 0 0 1 3.75 4.5h12.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 5.25Zm2.5 4.75a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 5.5 10Zm3 4.75a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5a.75.75 0 0 1-.75-.75Z" />
        </svg>
        {filterCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-blue-600 px-1 text-[11px] font-semibold text-white">
            {filterCount}
          </span>
        )}
      </button>
      <div className="relative">
        <button
          onClick={() => setMenu(!menu)}
          className="grid h-11 w-11 place-items-center rounded-full bg-white shadow-md ring-1 ring-slate-200"
          aria-label="Menu"
        >
          <svg className="h-5 w-5 text-slate-700" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M10 3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM10 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM11.5 15.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0Z" />
          </svg>
        </button>
        {menu && (
          <div className="absolute right-0 top-12 w-56 overflow-hidden rounded-xl bg-white py-1 text-[15px] shadow-lg ring-1 ring-slate-200" onClick={() => setMenu(false)}>
            <MenuItem onClick={() => navigate('stats')}>Stats</MenuItem>
            <MenuItem onClick={() => navigate('import')}>Import Takeout</MenuItem>
            <MenuItem
              onClick={() => {
                useApp.getState().setFilters({ needsReview: true })
                useApp.getState().setSheet('half')
              }}
            >
              Check locations{reviewCount ? ` (${reviewCount})` : ''}
            </MenuItem>
            <MenuItem onClick={() => navigate('settings')}>Settings</MenuItem>
          </div>
        )}
      </div>
    </div>
  )
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="block w-full px-4 py-2.5 text-left text-slate-800 hover:bg-slate-50">
      {children}
    </button>
  )
}
