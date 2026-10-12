import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMapPrefs, type BasemapId, type DetailId } from '../state/mapPrefs'
import { BASEMAPS } from './mapStyle'

const DETAILS: { id: DetailId; label: string; icon: ReactNode }[] = [
  {
    id: 'transit',
    label: 'Transit',
    icon: (
      <>
        <rect x="6" y="3" width="12" height="13" rx="3" />
        <path d="M6 10h12M9 13h.01M15 13h.01M9 16l-2 4M15 16l2 4" />
      </>
    ),
  },
  {
    id: 'traffic',
    label: 'Traffic',
    icon: (
      <>
        <rect x="8" y="2.5" width="8" height="19" rx="4" />
        <circle cx="12" cy="7" r="1.4" />
        <circle cx="12" cy="12" r="1.4" />
        <circle cx="12" cy="17" r="1.4" />
      </>
    ),
  },
  { id: 'terrain', label: 'Terrain', icon: <path d="M2.5 19.5 9 8l3.5 6 2.5-4 6.5 9.5h-19ZM7.2 11.2l1.8 1.3 1.6-1.2" /> },
  {
    id: 'buildings',
    label: '3D buildings',
    icon: <path d="M3 20.5h18M5 20.5V9l5-3v14.5M10 20.5V4l9 3.5v13M13 9.5h3M13 12.5h3M13 15.5h3M7 12h1M7 15h1" />,
  },
  {
    id: 'heatmap',
    label: 'Visited heatmap',
    icon: (
      <>
        <circle cx="9" cy="10" r="5.5" />
        <circle cx="9" cy="10" r="2" />
        <circle cx="16.5" cy="15.5" r="4" />
        <circle cx="16.5" cy="15.5" r="1.2" />
      </>
    ),
  },
  {
    id: 'cluster',
    label: 'Group nearby',
    icon: (
      <>
        <circle cx="12" cy="12" r="6.5" />
        <path d="M10.2 10.2h.01M13.8 10.2h.01M12 14h.01" strokeWidth="2.6" />
      </>
    ),
  },
  {
    id: 'globe',
    label: 'Globe',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z" />
      </>
    ),
  },
]

export function LayersPanel({ onClose }: { onClose: () => void }) {
  const basemap = useMapPrefs((s) => s.basemap)
  const details = useMapPrefs((s) => s.details)
  const trafficKey = useMapPrefs((s) => s.trafficKey)
  const trafficError = useMapPrefs((s) => s.trafficError)
  const hideWantToGo = useMapPrefs((s) => s.hideWantToGo)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-end justify-center">
      <div className="absolute inset-0 bg-slate-900/15" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-label="Map layers"
        data-testid="layers-panel"
        className="relative w-full max-w-md rounded-t-2xl bg-white dark:bg-slate-900 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_24px_rgba(15,23,42,0.18)] outline-none"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">Map type</h2>
          <button onClick={onClose} className="-mr-2 grid h-9 w-9 place-items-center rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
        <div role="radiogroup" aria-label="Map type" className="mt-2 grid grid-cols-4 gap-3">
          {BASEMAPS.map((b) => (
            <label key={b.id} className="group flex cursor-pointer flex-col items-center gap-1.5">
              <input type="radio" name="basemap" value={b.id} checked={basemap === b.id} onChange={() => useMapPrefs.getState().setBasemap(b.id)} className="peer sr-only" />
              <span
                className={`block aspect-square w-full overflow-hidden rounded-xl ring-offset-2 transition-shadow peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400 ${
                  basemap === b.id ? 'ring-2 ring-blue-600' : 'ring-1 ring-slate-200 dark:ring-slate-700'
                }`}
              >
                <Thumbnail id={b.id} />
              </span>
              <span className={`text-[13px] ${basemap === b.id ? 'font-semibold text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}`}>{b.label}</span>
            </label>
          ))}
        </div>

        <h2 className="mt-5 text-[15px] font-semibold text-slate-900 dark:text-slate-100">Places</h2>
        <label className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:ring-slate-700">
          <span className="text-[14px] text-slate-800 dark:text-slate-200">
            Show want-to-go places
            <span className="block text-[12px] text-slate-500 dark:text-slate-400">Off hides them from the map and the list</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={!hideWantToGo}
            onChange={(e) => useMapPrefs.getState().setHideWantToGo(!e.target.checked)}
            className="h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-slate-300 transition-colors before:block before:h-4 before:w-4 before:translate-x-0.5 before:translate-y-0.5 before:rounded-full before:bg-white before:shadow before:transition-transform checked:bg-blue-600 checked:before:translate-x-4 dark:bg-slate-600"
          />
        </label>

        <h2 className="mt-5 text-[15px] font-semibold text-slate-900 dark:text-slate-100">Map details</h2>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {DETAILS.map((d) => {
            const on = details[d.id]
            return (
              <button
                key={d.id}
                onClick={() => useMapPrefs.getState().toggleDetail(d.id)}
                aria-pressed={on}
                className="flex flex-col items-center gap-1.5 rounded-xl py-1 focus-visible:outline-2 focus-visible:outline-blue-400"
              >
                <span className={`grid h-12 w-12 place-items-center rounded-xl transition-colors ${on ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}>
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    {d.icon}
                  </svg>
                </span>
                <span className={`text-center text-[12px] leading-tight ${on ? 'font-semibold text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}`}>{d.label}</span>
              </button>
            )
          })}
        </div>

        {details.traffic && (!trafficKey || trafficError) && <TrafficKeyForm error={trafficError} />}
        {details.traffic && trafficKey && !trafficError && (
          <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">
            Live traffic from TomTom, using your key.{' '}
            <button className="text-blue-700 dark:text-blue-400 underline-offset-2 hover:underline" onClick={() => useMapPrefs.getState().setTrafficKey('')}>
              Remove key
            </button>
          </p>
        )}
        {details.terrain && <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">Hill shading shows at every zoom; it is most detailed in North America and parts of Europe.</p>}
      </div>
    </div>
  )
}

function TrafficKeyForm({ error }: { error: string | null }) {
  const [value, setValue] = useState('')
  return (
    <form
      className="mt-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 ring-1 ring-slate-200 dark:ring-slate-700"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) useMapPrefs.getState().setTrafficKey(value)
      }}
    >
      <p className="text-[13px] text-slate-600 dark:text-slate-400">
        {error ?? 'Live traffic comes from TomTom and needs an API key.'} Create a free one at{' '}
        <a href="https://developer.tomtom.com/" target="_blank" rel="noreferrer" className="text-blue-700 dark:text-blue-400 underline underline-offset-2">
          developer.tomtom.com
        </a>
        . It stays in this browser.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="TomTom API key"
          aria-label="TomTom API key"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-[14px]"
        />
        <button type="submit" className="rounded-lg bg-slate-900 dark:bg-slate-100 dark:text-slate-900 px-4 text-[14px] font-medium text-white disabled:opacity-40" disabled={!value.trim()}>
          Save
        </button>
      </div>
    </form>
  )
}

/** Small drawn previews, so the panel works offline and loads nothing. */
function Thumbnail({ id }: { id: BasemapId }) {
  const t = THUMBS[id]
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
      <rect width="64" height="64" fill={t.land} />
      {id === 'satellite' && (
        <>
          <path d="M0 0h30l-6 22H0Z" fill="#4d6b3c" />
          <path d="M34 30h30v34H40Z" fill="#6f6a4a" />
          <path d="M0 40h22l6 24H0Z" fill="#3e5a34" />
          <path d="M30 4h12v10H30ZM46 8h10v12H46ZM8 28h10v8H8Z" fill="#9a9384" opacity="0.8" />
        </>
      )}
      <path d="M0 46c10-4 18 4 28 0s14-10 22-8 10 4 14 3v23H0Z" fill={t.water} />
      {t.park && <path d="M38 6h18v16H38Z" rx="3" fill={t.park} />}
      <path d="M-2 30 66 18" stroke={t.casing} strokeWidth="6" />
      <path d="M-2 30 66 18" stroke={t.major} strokeWidth="4" />
      <path d="M22 -2 30 66" stroke={t.casing} strokeWidth="4" />
      <path d="M22 -2 30 66" stroke={t.minor} strokeWidth="2.5" />
      <path d="M-2 12 26 8M40 66 50 26" stroke={t.minor} strokeWidth="1.6" />
    </svg>
  )
}

const THUMBS: Record<BasemapId, { land: string; water: string; park?: string; major: string; minor: string; casing: string }> = {
  light: { land: '#f2f3f0', water: '#cdd9e2', park: '#e2eadb', major: '#ffffff', minor: '#ffffff', casing: '#d9dbd6' },
  streets: { land: '#f6f1e9', water: '#9fc7ec', park: '#c6e3a5', major: '#fcd581', minor: '#ffffff', casing: '#e4a95a' },
  dark: { land: '#1d1f22', water: '#0f1a24', park: '#1f2a23', major: '#43464b', minor: '#33363b', casing: '#26282c' },
  satellite: { land: '#5a6b45', water: '#1e3a4a', major: 'rgba(255,214,110,0.85)', minor: 'rgba(255,255,255,0.55)', casing: 'rgba(0,0,0,0.15)' },
}
