import { useState } from 'react'
import { categoryColor, categoryLabel } from '../domain/taxonomy'
import { chooseCandidate, confirmLocation, logVisit, removeLastVisit, setManualLocation, setUserTags } from '../db/placeRepo'
import { refresh, startPipeline } from '../state/actions'
import { useApp } from '../state/store'
import { areaLine, directionsUrl, distanceLabel, formatDate, googleMapsUrl, sourceLabel } from './format'

export function PlaceCard({ id }: { id: string }) {
  const v = useApp((s) => s.byId.get(id))
  const listById = useApp((s) => s.listById)
  const userLocation = useApp((s) => s.userLocation)
  const select = useApp((s) => s.select)
  const [tagDraft, setTagDraft] = useState('')
  const [pinMode, setPinMode] = useState(false)

  if (!v) return null
  const p = v.place
  const dist = distanceLabel(v, userLocation)

  const afterEdit = async (opts: { reenrich?: boolean } = {}) => {
    await refresh()
    if (opts.reenrich) void startPipeline()
  }

  return (
    <div className="h-full overflow-y-auto overscroll-contain px-4 pb-8" data-testid="place-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold leading-tight text-slate-900">{p.title}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[14px] text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: categoryColor(p.category) }} aria-hidden />
              {p.category ? categoryLabel(p.category) : 'Uncategorized'}
              {p.subcategory ? ` · ${p.subcategory.replace(/_/g, ' ')}` : ''}
            </span>
            {areaLine(v) && <span>· {areaLine(v)}</span>}
            {dist && <span>· {dist}</span>}
          </p>
          {p.businessStatus === 'CLOSED_PERMANENTLY' && <p className="mt-1 text-[13px] font-medium text-red-700">Permanently closed</p>}
          {p.businessStatus === 'CLOSED_TEMPORARILY' && <p className="mt-1 text-[13px] font-medium text-amber-700">Temporarily closed</p>}
        </div>
        <button onClick={() => select(null)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {v.visited && <Badge className="bg-green-100 text-green-800">Visited</Badge>}
        {v.wantToGo && <Badge className="bg-orange-100 text-orange-800">Want to go</Badge>}
        {v.listIds.map((lid) => {
          const l = listById.get(lid)
          return l ? (
            <Badge key={lid} className="bg-slate-100 text-slate-700">
              <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: l.color }} />
              {l.name}
            </Badge>
          ) : null
        })}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Action href={googleMapsUrl(v)}>Google Maps</Action>
        <Action href={directionsUrl(v, /iPhone|iPad|Mac/.test(navigator.userAgent) ? 'apple' : 'google')}>Directions</Action>
        <button
          onClick={async () => {
            await logVisit(p.id)
            await afterEdit()
          }}
          className="rounded-lg bg-slate-900 px-2 py-2.5 text-[14px] font-medium text-white"
        >
          Mark visited
        </button>
      </div>
      {!!v.user?.visits.length && (
        <p className="mt-2 text-[13px] text-slate-500">
          Logged visits: {v.user.visits.map((x) => formatDate(x.date)).join(', ')}.{' '}
          <button className="underline" onClick={async () => { await removeLastVisit(p.id); await afterEdit() }}>
            Undo last
          </button>{' '}
          Google's list is unchanged; add it there too if you want both to match.
        </p>
      )}

      {(p.resolveStatus === 'review' || p.resolveStatus === 'flagged' || p.resolveStatus === 'pending') && (
        <section className="mt-4 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200" data-testid="review-panel">
          <h3 className="text-[14px] font-semibold text-amber-900">
            {p.resolveStatus === 'pending'
              ? p.lat !== undefined
                ? 'Approximate location'
                : 'Not located yet'
              : p.resolveStatus === 'review'
                ? 'Location needs your help'
                : 'Check this location'}
          </h3>
          {p.resolveConfidence !== undefined && p.resolveStatus !== 'pending' && (
            <p className="text-[13px] text-amber-800">Match confidence {Math.round(p.resolveConfidence * 100)}%</p>
          )}
          {p.resolveCandidates?.map((c, i) => (
            <div key={i} className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-amber-100">
              <div className="min-w-0 text-[13px]">
                <div className="truncate font-medium text-slate-900">{c.name}</div>
                <div className="truncate text-slate-500">{c.address ?? `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`}</div>
              </div>
              <button
                className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1.5 text-[13px] font-medium text-white"
                onClick={async () => { await chooseCandidate(p.id, c); await afterEdit({ reenrich: true }) }}
              >
                Use this
              </button>
            </div>
          ))}
          <div className="mt-2 flex flex-wrap gap-2">
            {p.resolveStatus === 'flagged' && (
              <button className="rounded-md bg-white px-2.5 py-1.5 text-[13px] ring-1 ring-amber-300" onClick={async () => { await confirmLocation(p.id); await afterEdit() }}>
                Location is right
              </button>
            )}
            <button className="rounded-md bg-white px-2.5 py-1.5 text-[13px] ring-1 ring-amber-300" onClick={() => { if (!pinMode) useApp.getState().setSheet('half'); setPinMode(!pinMode) }}>
              {pinMode ? 'Cancel pin' : 'Place pin myself'}
            </button>
          </div>
          {pinMode && <PinPlacer onPlace={async (lat, lng) => { await setManualLocation(p.id, lat, lng); setPinMode(false); await afterEdit({ reenrich: true }) }} />}
        </section>
      )}

      {v.notes.length > 0 && (
        <section className="mt-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">Notes</h3>
          {v.notes.map((n, i) => (
            <p key={i} className="mt-1 whitespace-pre-line text-[15px] text-slate-800">{n}</p>
          ))}
        </section>
      )}

      <section className="mt-4">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">Tags</h3>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {v.tags.map((t) => (
            <Badge key={t} className="bg-blue-50 text-blue-800">
              {t}
              {v.user?.userTags.includes(t) && (
                <button className="ml-1 text-blue-500" aria-label={`Remove ${t}`} onClick={async () => { await setUserTags(p.id, v.user!.userTags.filter((x) => x !== t)); await afterEdit() }}>
                  ×
                </button>
              )}
            </Badge>
          ))}
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!tagDraft.trim()) return
              await setUserTags(p.id, [...(v.user?.userTags ?? []), tagDraft])
              setTagDraft('')
              await afterEdit()
            }}
          >
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              placeholder="+ tag"
              aria-label="Add tag"
              className="w-24 rounded-full bg-slate-100 px-2.5 py-1 text-[13px] outline-none focus:ring-1 focus:ring-blue-400"
            />
          </form>
        </div>
      </section>

      {(p.openingHours || p.website || p.googleAddress || p.address) && (
        <section className="mt-4 space-y-1 text-[14px] text-slate-700">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">Details</h3>
          {(p.address || p.googleAddress) && <p>{p.address ?? p.googleAddress}</p>}
          {p.openingHours && <p>Hours: {p.openingHours}</p>}
          {p.website && (
            <p>
              <a className="text-blue-700 underline" href={p.website} target="_blank" rel="noreferrer">
                {p.website.replace(/^https?:\/\//, '')}
              </a>
            </p>
          )}
        </section>
      )}

      <p className="mt-5 text-[12px] text-slate-400">
        First seen {formatDate(p.firstSeenAt)}
        {p.resolveSource ? ` · located via ${sourceLabel(p.resolveSource)}` : ''}
        {p.osmId ? ` · OSM ${p.osmId}` : ''}
      </p>
    </div>
  )
}

function PinPlacer({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  const pickPoint = useApp((s) => s.pickPoint)
  return (
    <div className="mt-2 rounded-lg bg-white p-2 text-[13px] text-slate-700 ring-1 ring-amber-100">
      Move the map so the place is under the crosshair, then confirm.
      <div className="mt-2 flex justify-end">
        <button
          disabled={!pickPoint}
          className="rounded-md bg-amber-600 px-2.5 py-1.5 font-medium text-white disabled:opacity-50"
          onClick={() => {
            const pt = pickPoint?.(window.innerWidth / 2, window.innerHeight * CROSSHAIR_Y)
            if (pt) onPlace(pt.lat, pt.lng)
          }}
        >
          Set pin here
        </button>
      </div>
      <Crosshair />
    </div>
  )
}

/** Vertical position of the crosshair: the middle of the map area above a half-open sheet. */
const CROSSHAIR_Y = 0.25

function Crosshair() {
  return (
    <div className="pointer-events-none fixed left-1/2 top-[25vh] z-30 -translate-x-1/2 -translate-y-1/2 text-3xl text-slate-900" aria-hidden>
      ＋
    </div>
  )
}

function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium ${className}`}>{children}</span>
}

function Action({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="rounded-lg bg-slate-100 px-2 py-2.5 text-center text-[14px] font-medium text-slate-800">
      {children}
    </a>
  )
}
