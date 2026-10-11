import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { categoryColor, categoryLabel } from '../domain/taxonomy'
import { useApp } from '../state/store'
import { areaLine, distanceLabel } from './format'

export function ResultList() {
  const result = useApp((s) => s.result)
  const userLocation = useApp((s) => s.userLocation)
  const select = useApp((s) => s.select)
  const parent = useRef<HTMLDivElement>(null)

  // eslint-disable-next-line react-hooks/incompatible-library -- virtualizer output is read during render only
  const virtualizer = useVirtualizer({
    count: result.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 60,
    overscan: 8,
  })

  if (!result.length) {
    return <p className="px-4 py-6 text-center text-sm text-slate-500">No places match these filters.</p>
  }

  return (
    <div ref={parent} className="h-full overflow-y-auto overscroll-contain" data-testid="result-list">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => {
          const v = result[row.index]!
          const dist = distanceLabel(v, userLocation)
          const color = categoryColor(v.place.category)
          return (
            <button
              key={v.id}
              onClick={() => select(v.id)}
              className="absolute left-0 flex w-full items-center gap-3 border-b border-slate-100 px-4 text-left hover:bg-slate-50"
              style={{ top: row.start, height: row.size }}
              data-testid="result-row"
            >
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-full"
                style={v.visited ? { background: color } : v.wantToGo ? { border: `2.5px solid ${color}` } : { background: color, opacity: 0.5 }}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-slate-900">{v.place.title}</span>
                <span className="block truncate text-[13px] text-slate-500">
                  {[v.place.category ? categoryLabel(v.place.category) : null, areaLine(v) || (v.lat === undefined ? 'Locating…' : null)].filter(Boolean).join(' · ')}
                </span>
              </span>
              {v.needsReview && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">Check</span>}
              {dist && <span className="shrink-0 text-[13px] tabular-nums text-slate-500">{dist}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
