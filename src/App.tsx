import { lazy, Suspense, useEffect, useState } from 'react'
import { MapView } from './ui/MapView'
import { SearchBar } from './ui/SearchBar'
import { BottomSheet } from './ui/BottomSheet'
import { ResultList } from './ui/ResultList'
import { PlaceCard } from './ui/PlaceCard'
import { FilterPanel } from './ui/FilterPanel'
import { SheetHeader } from './ui/SheetHeader'
import { MapButtons } from './ui/MapButtons'
import { PipelineBanner } from './ui/PipelineBanner'
import { navigate, useRoute } from './ui/router'
import { useApp } from './state/store'
import { startPipeline } from './state/actions'

// Import, stats and settings are occasional; keep them out of the startup bundle.
const ImportScreen = lazy(() => import('./ui/ImportScreen').then((m) => ({ default: m.ImportScreen })))
const SettingsScreen = lazy(() => import('./ui/SettingsScreen').then((m) => ({ default: m.SettingsScreen })))
const StatsScreen = lazy(() => import('./ui/StatsScreen').then((m) => ({ default: m.StatsScreen })))

export default function App() {
  const route = useRoute()
  const ready = useApp((s) => s.ready)
  const empty = useApp((s) => s.ready && s.views.length === 0)
  const selectedId = useApp((s) => s.selectedId)
  const needsRoles = useApp((s) => s.lists.some((l) => l.role === null))
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    void useApp
      .getState()
      .load()
      .then(() => startPipeline())
    void navigator.storage?.persist?.()
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden bg-slate-100 dark:bg-slate-800">
      <div className="pointer-events-auto">
        <MapView />
      </div>
      <SearchBar onOpenFilters={() => setFiltersOpen(true)} />
      <PipelineBanner />
      {!empty && <MapButtons />}
      {ready && empty && <EmptyState />}
      {ready && !empty && needsRoles && route === 'map' && (
        <button onClick={() => navigate('import')} className="pointer-events-auto absolute inset-x-3 top-[64px] z-20 rounded-xl bg-blue-600 px-4 py-2.5 text-left text-[14px] font-medium text-white shadow-md">
          New lists found. Tap to tell Hexplore what they mean.
        </button>
      )}
      {!empty && (
        <BottomSheet header={<SheetHeader />}>{selectedId ? <PlaceCard id={selectedId} /> : <ResultList />}</BottomSheet>
      )}
      {filtersOpen && <FilterPanel onClose={() => setFiltersOpen(false)} />}
      <Suspense fallback={null}>
        {route === 'import' && <ImportScreen />}
        {route === 'settings' && <SettingsScreen />}
        {route === 'stats' && <StatsScreen />}
      </Suspense>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="pointer-events-auto absolute inset-x-4 bottom-6 z-10 rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-lg" data-testid="empty-state">
      <h1 className="text-[20px] font-semibold text-slate-900 dark:text-slate-100">Your places, on one map</h1>
      <p className="mt-1 text-[15px] text-slate-600 dark:text-slate-400">Import your Google Maps saved places from Takeout to get started, or try it with sample data.</p>
      <button onClick={() => navigate('import')} className="mt-4 w-full rounded-xl bg-slate-900 dark:bg-slate-100 dark:text-slate-900 py-3 text-[16px] font-semibold text-white" data-testid="go-import">
        Import places
      </button>
    </div>
  )
}
