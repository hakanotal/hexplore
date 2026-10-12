import { useEffect, useState, type ReactNode } from 'react'
import { categoryColor } from '../domain/taxonomy'
import { emptyFilters, type Filters } from '../query/filters'
import type { Conversion, MonthRow, Row, Stats } from '../stats/compute'
import { useMapPrefs } from '../state/mapPrefs'
import { useApp } from '../state/store'
import { dataWorker } from '../workers/client'
import { formatDate } from './format'
import { Page } from './Page'
import { navigate } from './router'
import { Key, SAVED_COLOR, VISITED_COLOR, WorldMap } from './WorldMap'

// Where you have been and what you like. Every number opens the matching
// places on the map. Bars use one blue in two steps (visited, then the rest
// of what is saved); each theme's pair is validated against its surface.

const ACCENT = 'var(--viz-accent)'
const TRACK = 'var(--viz-track)'

function showOnMap(patch: Partial<Filters>) {
  const app = useApp.getState()
  app.replaceFilters({ ...emptyFilters(), ...patch })
  app.select(null)
  app.setSheet('half')
  navigate('map')
  app.requestFit()
}

function openPlace(id: string) {
  const app = useApp.getState()
  app.replaceFilters(emptyFilters())
  navigate('map')
  app.select(id)
}

export function StatsScreen() {
  const [stats, setStats] = useState<Stats | null>(null)
  const views = useApp((s) => s.views)
  const lists = useApp((s) => s.lists)

  useEffect(() => {
    let live = true
    void dataWorker()
      .stats()
      .then((s) => live && setStats(s))
    return () => {
      live = false
    }
  }, [views])

  if (!stats) return <Page title="Stats">{null}</Page>
  if (!stats.totals.saved) {
    return (
      <Page title="Stats">
        <p className="text-[15px] text-slate-600 dark:text-slate-400">Import your places to see where you have been.</p>
      </Page>
    )
  }

  const t = stats.totals
  const favoriteLists = lists.filter((l) => l.role === 'favorite').map((l) => l.id)

  return (
    <Page title="Stats">
      <section aria-label="Totals" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile label="Saved" value={t.saved} onClick={() => showOnMap({})} />
        <Tile label="Visited" value={t.visited} onClick={() => showOnMap({ status: ['visited'] })} />
        <Tile label="Want to go" value={t.wantToGo} onClick={() => showOnMap({ status: ['wantToGo'] })} />
        {favoriteLists.length > 0 && <Tile label="Favorites" value={t.favorites} onClick={() => showOnMap({ lists: favoriteLists })} />}
        <Tile label="Countries visited" value={t.visitedCountries} detail={`of ${t.countries} with saved places`} />
        <Tile label="Cities visited" value={t.visitedCities} detail={`of ${t.cities}`} />
        <Tile label="Neighborhoods visited" value={t.visitedNeighborhoods} detail={`of ${t.neighborhoods}`} />
      </section>
      {t.located < t.saved && (
        <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">
          {t.saved - t.located} {t.saved - t.located === 1 ? 'place is' : 'places are'} not located yet, so area counts may still grow.
        </p>
      )}

      <Section title="Coverage">
        <WorldMap rows={stats.countries} onSelect={(r) => showOnMap({ countries: [r.key] })} />
        <h3 className="mt-5 text-[14px] font-semibold text-slate-800 dark:text-slate-200">Countries</h3>
        <Bars rows={stats.countries} onPick={(r) => showOnMap({ countries: [r.key] })} />
        <h3 className="mt-5 text-[14px] font-semibold text-slate-800 dark:text-slate-200">Cities</h3>
        <Bars
          rows={stats.cities}
          onPick={(r) => showOnMap({ cities: [r.key] })}
          detail={(r) => {
            const c = stats.cities.find((x) => x.key === r.key)!
            return c.neighborhoods ? `${c.visitedNeighborhoods} of ${c.neighborhoods} neighborhoods visited` : c.country
          }}
        />
      </Section>

      <Section title="Taste" legend>
        <h3 className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">Categories</h3>
        <Bars rows={stats.categories} limit={13} dot={(r) => categoryColor(r.key === 'uncategorized' ? undefined : r.key)} onPick={(r) => showOnMap({ categories: [r.key] })} />
        {stats.cuisines.length > 0 && (
          <>
            <h3 className="mt-5 text-[14px] font-semibold text-slate-800 dark:text-slate-200">Cuisines</h3>
            <Bars rows={stats.cuisines} />
          </>
        )}
        {stats.tags.length > 0 && (
          <>
            <h3 className="mt-5 text-[14px] font-semibold text-slate-800 dark:text-slate-200">Tags</h3>
            <Bars rows={stats.tags} onPick={(r) => showOnMap({ tags: [r.key] })} />
          </>
        )}
      </Section>

      <Section title="Backlog">
        {stats.backlog.conversion.wanted > 0 && stats.backlog.conversion.visited === 0 && (
          <p className="text-[14px] text-slate-700 dark:text-slate-300">
            None of the {stats.backlog.conversion.wanted.toLocaleString()} places you wanted to go is visited yet. When a place moves to a visited list in a later
            import, it counts here.
          </p>
        )}
        {stats.backlog.conversion.visited > 0 && (
          <>
            <Meter
              value={stats.backlog.conversion.visited}
              of={stats.backlog.conversion.wanted}
              label={`You have been to ${percent(stats.backlog.conversion)} of the places you wanted to go`}
            />
            {stats.backlog.conversionByCity.length > 1 && (
              <>
                <h3 className="mt-5 text-[14px] font-semibold text-slate-800 dark:text-slate-200">Wanted, then visited, by city</h3>
                <Conversions rows={stats.backlog.conversionByCity} onPick={(c) => showOnMap({ cities: [c.key] })} />
              </>
            )}
            {stats.backlog.conversionByCategory.length > 1 && (
              <>
                <h3 className="mt-5 text-[14px] font-semibold text-slate-800 dark:text-slate-200">Wanted, then visited, by category</h3>
                <Conversions rows={stats.backlog.conversionByCategory} onPick={(c) => showOnMap({ categories: [c.key] })} />
              </>
            )}
          </>
        )}
        {stats.backlog.wantByCity.length > 0 && (
          <>
            <h3 className="mt-5 text-[14px] font-semibold text-slate-800 dark:text-slate-200">Still want to go, by city</h3>
            <Counts rows={stats.backlog.wantByCity.map((r) => ({ key: r.key, label: r.label, value: r.wantToGo }))} onPick={(key) => showOnMap({ status: ['wantToGo'], cities: [key] })} />
          </>
        )}
        {/* On a first import every place shares one date, so "longest" would only be alphabetical. */}
        {stats.backlog.oldest.some((o) => stats.growth.trackingSince === undefined || o.since > stats.growth.trackingSince) && (
          <>
            <h3 className="mt-5 text-[14px] font-semibold text-slate-800 dark:text-slate-200">Waiting longest</h3>
            <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
              {stats.backlog.oldest.map((o) => (
                <li key={o.id}>
                  <button onClick={() => openPlace(o.id)} className="flex w-full items-baseline justify-between gap-3 py-2 text-left">
                    <span className="min-w-0 truncate text-[14px] text-slate-900 dark:text-slate-100">
                      {o.title}
                      {o.city && <span className="text-slate-500 dark:text-slate-400"> · {o.city}</span>}
                    </span>
                    <span className="shrink-0 text-[12px] text-slate-500 dark:text-slate-400">
                      {stats.growth.trackingSince !== undefined && o.since <= stats.growth.trackingSince ? 'before tracking' : `since ${formatDate(o.since)}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section title="Growth">
        {stats.growth.trackingSince !== undefined && (
          <p className="text-[13px] text-slate-600 dark:text-slate-400">
            {stats.growth.beforeTracking.toLocaleString()} places came with your first import on {formatDate(stats.growth.trackingSince)}. Takeout has no save dates, so
            growth counts from then on.
          </p>
        )}
        {stats.growth.months.some((m) => m.added) && (
          <Columns
            title="Places added per month"
            months={stats.growth.months}
            value={(m) => m.added}
            onPick={(m) => showOnMap({ seenFrom: `${m.month}-01`, seenTo: lastDay(m.month) })}
          />
        )}
        {stats.growth.months.some((m) => m.visits) && <Columns title="Visits logged per month" months={stats.growth.months} value={(m) => m.visits} />}
      </Section>

      <Section title="Heatmap">
        <p className="text-[13px] text-slate-600 dark:text-slate-400">See where your visited places cluster, as a layer on the map.</p>
        <button
          onClick={() => {
            if (!useMapPrefs.getState().details.heatmap) useMapPrefs.getState().toggleDetail('heatmap')
            showOnMap({})
          }}
          className="mt-2 rounded-lg bg-slate-900 dark:bg-slate-100 dark:text-slate-900 px-4 py-2 text-[14px] font-medium text-white"
        >
          Show heatmap on the map
        </button>
      </Section>
    </Page>
  )
}

function percent(c: { wanted: number; visited: number }): string {
  return `${Math.round((c.visited / c.wanted) * 100)}%`
}

function lastDay(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

function Section({ title, legend, children }: { title: string; legend?: boolean; children: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        {legend && (
          <p className="flex gap-3 text-[12px] text-slate-600 dark:text-slate-400">
            <Key color={VISITED_COLOR}>Visited</Key>
            <Key color={SAVED_COLOR}>Saved</Key>
          </p>
        )}
      </div>
      {children}
    </section>
  )
}

function Tile({ label, value, detail, onClick }: { label: string; value: number; detail?: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="block text-[13px] text-slate-600 dark:text-slate-400">{label}</span>
      <span className="mt-0.5 block text-[24px] font-semibold leading-tight text-slate-900 dark:text-slate-100">{value.toLocaleString()}</span>
      {detail && <span className="block text-[12px] text-slate-500 dark:text-slate-400">{detail}</span>}
    </>
  )
  const cls = 'rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5 text-left ring-1 ring-slate-200 dark:ring-slate-700'
  return onClick ? (
    <button onClick={onClick} className={`${cls} hover:bg-slate-100 dark:hover:bg-slate-800`} aria-label={`${label}: ${value}. Show on map`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** Two-step bars: visited from the baseline, then the rest of what is saved, a 2px gap between. */
function Bars({ rows, onPick, dot, detail, limit = 8 }: { rows: Row[]; onPick?: (r: Row) => void; dot?: (r: Row) => string; detail?: (r: Row) => string | undefined; limit?: number }) {
  const [all, setAll] = useState(false)
  const max = Math.max(1, ...rows.map((r) => r.saved))
  const shown = all ? rows : rows.slice(0, limit)
  return (
    <div>
      <ul className="mt-1 space-y-1">
        {shown.map((r) => {
          const rest = r.saved - r.visited
          const sub = detail?.(r)
          const inner = (
            <>
              <span className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5 text-[14px] text-slate-900 dark:text-slate-100">
                  {dot && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot(r) }} aria-hidden />}
                  <span className="truncate">{r.label}</span>
                </span>
                <span className="shrink-0 text-[13px] tabular-nums text-slate-600 dark:text-slate-400">
                  {r.visited.toLocaleString()} <span className="text-slate-400 dark:text-slate-500">of</span> {r.saved.toLocaleString()}
                </span>
              </span>
              <span className="mt-1 flex h-2.5 w-full" aria-hidden>
                {r.visited > 0 && <span className={rest ? '' : 'rounded-r'} style={{ width: `${(r.visited / max) * 100}%`, background: VISITED_COLOR }} />}
                {rest > 0 && <span className="rounded-r" style={{ width: `${(rest / max) * 100}%`, background: SAVED_COLOR, marginLeft: r.visited ? 2 : 0 }} />}
              </span>
              {sub && <span className="mt-0.5 block text-[12px] text-slate-500 dark:text-slate-400">{sub}</span>}
            </>
          )
          return (
            <li key={r.key}>
              {onPick ? (
                <button onClick={() => onPick(r)} className="block w-full rounded-lg px-1 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800" aria-label={`${r.label}: ${r.visited} visited of ${r.saved} saved. Show on map`}>
                  {inner}
                </button>
              ) : (
                <div className="px-1 py-1.5">{inner}</div>
              )}
            </li>
          )
        })}
      </ul>
      {rows.length > limit && (
        <button onClick={() => setAll(!all)} className="mt-1 px-1 text-[13px] text-blue-700 dark:text-blue-400">
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  )
}

function Counts({ rows, onPick, limit = 8 }: { rows: { key: string; label: string; value: number }[]; onPick: (key: string) => void; limit?: number }) {
  const [all, setAll] = useState(false)
  const max = Math.max(1, ...rows.map((r) => r.value))
  const shown = all ? rows : rows.slice(0, limit)
  return (
    <div>
      <ul className="mt-1 space-y-1">
        {shown.map((r) => (
          <li key={r.key}>
            <button onClick={() => onPick(r.key)} className="block w-full rounded-lg px-1 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800" aria-label={`${r.label}: ${r.value}. Show on map`}>
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[14px] text-slate-900 dark:text-slate-100">{r.label}</span>
                <span className="shrink-0 text-[13px] tabular-nums text-slate-600 dark:text-slate-400">{r.value.toLocaleString()}</span>
              </span>
              <span className="mt-1 flex h-2.5 w-full" aria-hidden>
                <span className="rounded-r" style={{ width: `${(r.value / max) * 100}%`, background: ACCENT }} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {rows.length > limit && (
        <button onClick={() => setAll(!all)} className="mt-1 px-1 text-[13px] text-blue-700 dark:text-blue-400">
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  )
}

function Meter({ value, of, label }: { value: number; of: number; label: string }) {
  return (
    <div>
      <p className="text-[14px] text-slate-800 dark:text-slate-200">{label}</p>
      <div className="mt-2 flex h-2.5 w-full rounded-r" style={{ background: TRACK }} role="meter" aria-valuemin={0} aria-valuemax={of} aria-valuenow={value} aria-label={label}>
        <span className="rounded-r" style={{ width: `${(value / of) * 100}%`, background: ACCENT }} />
      </div>
      <p className="mt-1 text-[12px] tabular-nums text-slate-500 dark:text-slate-400">
        {value.toLocaleString()} of {of.toLocaleString()}
      </p>
    </div>
  )
}

function Conversions({ rows, onPick }: { rows: Conversion[]; onPick: (c: Conversion) => void }) {
  return (
    <ul className="mt-1 space-y-1">
      {rows.map((c) => (
        <li key={c.key}>
          <button onClick={() => onPick(c)} className="block w-full rounded-lg px-1 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800" aria-label={`${c.label}: ${c.visited} of ${c.wanted} visited. Show on map`}>
            <span className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[14px] text-slate-900 dark:text-slate-100">{c.label}</span>
              <span className="shrink-0 text-[13px] tabular-nums text-slate-600 dark:text-slate-400">
                {percent(c)} <span className="text-slate-400 dark:text-slate-500">·</span> {c.visited} of {c.wanted}
              </span>
            </span>
            <span className="mt-1 flex h-2.5 w-full rounded-r" style={{ background: TRACK }} aria-hidden>
              <span className="rounded-r" style={{ width: `${(c.visited / c.wanted) * 100}%`, background: ACCENT }} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

const MONTH = new Intl.DateTimeFormat(undefined, { month: 'short' })

/** Monthly columns from one baseline; values on the caps, month labels thinned to fit. */
function Columns({ title, months, value, onPick }: { title: string; months: MonthRow[]; value: (m: MonthRow) => number; onPick?: (m: MonthRow) => void }) {
  if (!months.length) return null
  const H = 96
  const max = Math.max(1, ...months.map(value))
  const band = 100 / months.length
  const every = Math.ceil(months.length / 8)
  return (
    <figure className="mt-4">
      <figcaption className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">{title}</figcaption>
      <div className="relative mt-2 border-b border-slate-200 dark:border-slate-700" style={{ height: H + 18 }}>
        {months.map((m, i) => {
          const v = value(m)
          const h = (v / max) * H
          const col = (
            <>
              {v > 0 && (
                <span className="absolute inset-x-0 text-center text-[11px] tabular-nums text-slate-600 dark:text-slate-400" style={{ bottom: h + 2 }}>
                  {v}
                </span>
              )}
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-t" style={{ height: Math.max(v ? 2 : 0, h), width: 'min(24px, 60%)', background: ACCENT }} />
            </>
          )
          const style = { left: `${i * band}%`, width: `${band}%` }
          const label = `${m.month}: ${v}`
          return onPick && v ? (
            <button key={m.month} onClick={() => onPick(m)} className="absolute bottom-0 top-0 hover:bg-slate-50 dark:hover:bg-slate-800" style={style} aria-label={`${label}. Show on map`} title={label}>
              {col}
            </button>
          ) : (
            <div key={m.month} className="absolute bottom-0 top-0" style={style} title={label}>
              {col}
            </div>
          )
        })}
      </div>
      <div className="relative h-4 text-[11px] text-slate-500 dark:text-slate-400">
        {months.map((m, i) =>
          i % every === 0 ? (
            <span key={m.month} className="absolute -translate-x-1/2" style={{ left: `${(i + 0.5) * band}%` }}>
              {MONTH.format(new Date(Number(m.month.slice(0, 4)), Number(m.month.slice(5)) - 1, 1))}
            </span>
          ) : null,
        )}
      </div>
    </figure>
  )
}
