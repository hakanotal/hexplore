import { useMemo } from 'react'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import world from 'world-atlas/countries-110m.json'
import type { CountryRow } from '../stats/compute'
import { NAME_TO_ALPHA2, NUMERIC_TO_ALPHA2 } from '../stats/countryCodes'

// Visited countries on a plain SVG world map: equirectangular, Antarctica left
// out. Natural Earth 1:110m shapes from world-atlas, bundled into the lazy
// stats chunk so the screen works offline.

export const VISITED_COLOR = '#1e40af'
export const SAVED_COLOR = '#60a5fa'
const EMPTY_COLOR = '#e2e8f0'

const TOP = 84
const BOTTOM = -58
const WIDTH = 360
const HEIGHT = TOP - BOTTOM

interface Shape {
  code?: string
  name: string
  d: string
}

let cache: Shape[] | undefined

function shapes(): Shape[] {
  if (cache) return cache
  const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>
  const fc = feature(topo, topo.objects.countries)
  cache = fc.features
    .map((f) => ({
      code: (f.id !== undefined ? NUMERIC_TO_ALPHA2[String(f.id)] : undefined) ?? NAME_TO_ALPHA2[f.properties.name],
      name: f.properties.name,
      d: pathOf(f.geometry),
    }))
    .filter((s) => s.code !== 'AQ')
  return cache
}

function pathOf(g: GeoJSON.Geometry | null): string {
  if (!g) return ''
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
  let d = ''
  for (const polygon of polygons) {
    for (const ring of polygon) {
      let prev: number | undefined
      ring.forEach(([lng, lat], i) => {
        // A ring wrapping the antimeridian would streak across the map; break it there.
        const jump = prev !== undefined && Math.abs(lng! - prev) > 180
        const x = lng! + 180
        const y = TOP - Math.max(BOTTOM, Math.min(TOP, lat!))
        d += `${i === 0 || jump ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
        prev = lng
      })
      d += 'Z'
    }
  }
  return d
}

export function WorldMap({ rows, onSelect }: { rows: CountryRow[]; onSelect: (row: CountryRow) => void }) {
  const lookup = useMemo(() => {
    const byCode = new Map<string, CountryRow>()
    const byName = new Map<string, CountryRow>()
    for (const r of rows) {
      if (r.code) byCode.set(r.code.toUpperCase(), r)
      byName.set(r.key.toLowerCase(), r)
    }
    return (s: Shape) => (s.code ? byCode.get(s.code) : undefined) ?? byName.get(s.name.toLowerCase())
  }, [rows])

  return (
    <figure>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="group" aria-label="World map of countries with saved places">
        {shapes().map((s, i) => {
          const r = lookup(s)
          const fill = !r ? EMPTY_COLOR : r.visited ? VISITED_COLOR : SAVED_COLOR
          const label = r ? `${r.label}: ${r.visited} visited of ${r.saved} saved` : s.name
          return (
            <path
              key={i}
              d={s.d}
              fill={fill}
              stroke="#ffffff"
              strokeWidth={0.35}
              strokeLinejoin="round"
              className={r ? 'cursor-pointer outline-none hover:opacity-80 focus-visible:opacity-70' : undefined}
              role={r ? 'button' : undefined}
              tabIndex={r ? 0 : undefined}
              aria-label={r ? `${label}. Show on map` : undefined}
              onClick={r ? () => onSelect(r) : undefined}
              onKeyDown={r ? (e) => (e.key === 'Enter' || e.key === ' ') && onSelect(r) : undefined}
            >
              <title>{label}</title>
            </path>
          )
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-600">
        <Key color={VISITED_COLOR}>Visited</Key>
        <Key color={SAVED_COLOR}>Saved, not visited yet</Key>
        <Key color={EMPTY_COLOR}>No saved places</Key>
      </figcaption>
    </figure>
  )
}

export function Key({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} aria-hidden />
      {children}
    </span>
  )
}
