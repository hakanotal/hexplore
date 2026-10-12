import { cancelPipeline } from '../state/actions'
import { useApp } from '../state/store'

const STAGE_LABEL = { resolve: 'Locating places', area: 'Finding neighborhoods', classify: 'Categorizing', match: 'Matching to OpenStreetMap', embed: 'Indexing', idle: 'Finishing' } as const

export function PipelineBanner() {
  const p = useApp((s) => s.pipeline)
  if (!p || p.stage === 'idle') return null
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
  return (
    <div className="pointer-events-auto absolute inset-x-3 top-[64px] z-20 rounded-xl bg-white/95 dark:bg-slate-900/95 px-4 py-2.5 shadow-md ring-1 ring-slate-200 dark:ring-slate-700" role="status" data-testid="pipeline-banner">
      <div className="flex items-center justify-between text-[13px] text-slate-700 dark:text-slate-300">
        <span>
          {STAGE_LABEL[p.stage]} · {p.done.toLocaleString()} of {p.total.toLocaleString()}
          {p.review > 0 && <span className="text-amber-700 dark:text-amber-400"> · {p.review} need a check</span>}
        </span>
        <button onClick={cancelPipeline} className="text-slate-500 dark:text-slate-400 underline">Pause</button>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className="h-full bg-blue-600 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
