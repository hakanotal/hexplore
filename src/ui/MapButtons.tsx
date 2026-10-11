import { useState } from 'react'
import { useApp } from '../state/store'

const RADII = [0.5, 1, 5]

export function MapButtons() {
  const bounds = useApp((s) => s.mapBounds)
  const hasBbox = useApp((s) => !!s.filters.bbox)
  const near = useApp((s) => s.filters.near)
  const sheet = useApp((s) => s.sheet)
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)

  const nearMe = () => {
    if (near) {
      // Cycle the radius ring, then turn it off.
      const i = RADII.indexOf(near.km)
      if (i < RADII.length - 1) useApp.getState().setFilters({ near: { ...near, km: RADII[i + 1]! } })
      else {
        useApp.getState().setFilters({ near: undefined })
        useApp.getState().setUserLocation(null)
      }
      return
    }
    if (!navigator.geolocation) return setGeoError('Location is not available in this browser')
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        setGeoError(null)
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        useApp.getState().setUserLocation(p)
        useApp.getState().setFilters({ near: { ...p, km: 1 } })
        useApp.getState().setSheet('half')
      },
      (err) => {
        setLocating(false)
        setGeoError(err.message || 'Could not get your location')
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  }

  if (sheet === 'full') return null
  return (
    <div className="pointer-events-auto absolute right-3 z-10 flex flex-col items-end gap-2" style={{ bottom: sheet === 'peek' ? 148 : 'calc(50% + 16px)' }}>
      {geoError && <p className="max-w-56 rounded-lg bg-white px-3 py-2 text-[13px] text-slate-700 shadow">{geoError}</p>}
      {bounds && (
        <button
          onClick={() => useApp.getState().setFilters({ bbox: hasBbox ? undefined : bounds })}
          className={`rounded-full px-4 py-2 text-[14px] font-medium shadow-md ring-1 ${hasBbox ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-800 ring-slate-200'}`}
        >
          {hasBbox ? 'Clear area' : 'Search this area'}
        </button>
      )}
      <button
        onClick={nearMe}
        className={`rounded-full px-4 py-2 text-[14px] font-medium shadow-md ring-1 ${near ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-slate-800 ring-slate-200'}`}
        aria-label="Near me"
      >
        {locating ? 'Locating…' : near ? `Near me · ${near.km < 1 ? `${near.km * 1000} m` : `${near.km} km`}` : 'Near me'}
      </button>
    </div>
  )
}
