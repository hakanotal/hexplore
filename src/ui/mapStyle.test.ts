import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'
import { DEFAULT_DETAILS, restorePrefs, type BasemapId, type MapDetails } from '../state/mapPrefs'
import { BLANK_STYLE, composeStyle, type ComposeInput } from './mapStyle'
import { DARK_THEME, LIGHT_THEME } from './placeLayers'

// A trimmed Positron: the layer kinds composeStyle treats differently.
const BASE: StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.example.test/fonts/{fontstack}/{range}.pbf',
  sprite: 'https://tiles.example.test/sprites/ofm',
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.example.test/planet' } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#f2f3f0' } },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': '#cdd9e2' } },
    { id: 'highway_path', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': '#fff' } },
    { id: 'highway_minor', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': '#fff', 'line-width': 20 } },
    { id: 'boundary_2', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary', paint: { 'line-color': '#999' } },
    { id: 'poi_r1', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', layout: { 'text-field': ['get', 'name'] } },
    { id: 'label_city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: { 'text-field': ['get', 'name'] }, paint: { 'text-color': '#000' } },
  ],
}

const FC = (n: number): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: Array.from({ length: n }, (_, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [i, i] }, properties: { id: `p${i}` } })),
})

const EMPTY = FC(0)
const PLACE_LAYERS = ['near-fill', 'near-line', 'clusters', 'cluster-count', 'points', 'selected', 'me']

function compose(patch: Partial<Omit<ComposeInput, 'details'>> & { details?: Partial<MapDetails> } = {}, base = BASE): StyleSpecification {
  return composeStyle(base, {
    basemap: 'light',
    trafficKey: '',
    network: true,
    data: { places: FC(3), heat: FC(2), near: EMPTY, me: EMPTY },
    selectedId: null,
    ...patch,
    details: { ...DEFAULT_DETAILS, ...patch.details },
  })
}

const ids = (s: StyleSpecification) => s.layers.map((l) => l.id)
const layer = (s: StyleSpecification, id: string) => s.layers.find((l) => l.id === id) as LayerSpecification & { paint?: Record<string, unknown>; filter?: unknown }
const ALL_ON: MapDetails = { transit: true, traffic: true, terrain: true, buildings: true, heatmap: true, globe: true }

describe('composeStyle', () => {
  // MapLibre drops the whole style change when one expression is invalid, so
  // every combination has to pass the style spec.
  it('produces a valid style for every map type and detail', () => {
    const detailSets: Partial<MapDetails>[] = [{}, ALL_ON, { transit: true }, { terrain: true }, { buildings: true }, { traffic: true }, { heatmap: true }, { globe: true }]
    for (const basemap of ['light', 'streets', 'dark', 'satellite'] as BasemapId[]) {
      for (const details of detailSets) {
        const errors = validateStyleMin(compose({ basemap, details, trafficKey: 'k', selectedId: 'p1' }))
        expect(errors.map((e) => e.message), `${basemap} ${JSON.stringify(details)}`).toEqual([])
      }
    }
    expect(validateStyleMin(compose({ network: false, details: ALL_ON }, BLANK_STYLE))).toEqual([])
  })

  it('keeps the base, drops POI icons and puts your places on top', () => {
    const s = compose()
    expect(ids(s)).toEqual(['background', 'water', 'highway_path', 'highway_minor', 'boundary_2', 'label_city', ...PLACE_LAYERS])
    expect(s.projection).toEqual({ type: 'mercator' })
    expect(s.sky).toBeUndefined()
    expect(Object.keys(s.sources).filter((k) => k.startsWith('hx-'))).toEqual([])
  })

  it('carries the current data and selection so a style swap keeps your points', () => {
    const places = FC(5)
    const heat = FC(2)
    const s = compose({ data: { places, heat, near: EMPTY, me: EMPTY }, selectedId: 'p2' })
    expect(s.sources.places).toMatchObject({ type: 'geojson', data: places, cluster: true })
    expect(s.sources.heat).toMatchObject({ type: 'geojson', data: heat })
    expect(layer(s, 'selected').filter).toEqual(['==', ['get', 'id'], 'p2'])
  })

  it('never mutates the cached base style', () => {
    const before = structuredClone(BASE)
    compose({ basemap: 'satellite', details: ALL_ON, trafficKey: 'k' })
    expect(BASE).toEqual(before)
  })

  it('satellite lays imagery under white labels, borders and a light road overlay', () => {
    const s = compose({ basemap: 'satellite' })
    expect(ids(s)).toEqual(['hx-imagery-bg', 'hx-imagery', 'highway_minor', 'boundary_2', 'label_city', ...PLACE_LAYERS])
    expect(s.sources['hx-imagery']).toMatchObject({ type: 'raster', maxzoom: 19 })
    expect(layer(s, 'label_city').paint?.['text-color']).toBe('#ffffff')
    expect(layer(s, 'highway_minor').paint?.['line-width']).not.toBe(20)
    expect(layer(s, 'clusters').paint?.['circle-color']).toBe(DARK_THEME.cluster)
  })

  it('places detail layers between roads, labels and your places', () => {
    const s = compose({ details: ALL_ON, trafficKey: 'abc' })
    const order = ids(s)
    const at = (id: string) => order.indexOf(id)
    // Hill shading under the first line layer, traffic and transit lines under labels.
    expect(at('hx-hillshade')).toBe(at('highway_path') - 1)
    for (const id of ['hx-traffic', 'hx-transit-rail', 'hx-transit-metro', 'hx-buildings-3d']) {
      expect(at(id)).toBeGreaterThan(at('boundary_2'))
      expect(at(id)).toBeLessThan(at('label_city'))
    }
    // Stations above base labels, below your places.
    expect(at('hx-transit-stations')).toBe(at('label_city') + 1)
    expect(order.slice(-PLACE_LAYERS.length - 1)).toEqual(['near-fill', 'near-line', 'heat', ...PLACE_LAYERS.slice(2)])
    expect(s.projection).toEqual({ type: 'globe' })
    expect(s.sky).toBeDefined()
    expect(s.metadata).toMatchObject({ 'hexplore:basemap': 'light', 'hexplore:details': ['terrain', 'traffic', 'buildings', 'transit', 'heatmap', 'globe'] })
  })

  it('puts hill shading right above the imagery on satellite', () => {
    const order = ids(compose({ basemap: 'satellite', details: { terrain: true } }))
    expect(order.indexOf('hx-hillshade')).toBe(order.indexOf('hx-imagery') + 1)
  })

  it('needs a key for traffic and passes it to TomTom', () => {
    expect(ids(compose({ details: { traffic: true } }))).not.toContain('hx-traffic')
    const s = compose({ basemap: 'dark', details: { traffic: true }, trafficKey: 'a b' })
    const src = s.sources['hx-traffic'] as { tiles: string[] }
    expect(src.tiles[0]).toContain('/flow/relative0-dark/')
    expect(src.tiles[0]).toContain('key=a%20b')
  })

  it('adds nothing that fetches tiles when offline', () => {
    for (const basemap of ['light', 'streets', 'dark', 'satellite'] as BasemapId[]) {
      const s = compose({ basemap, network: false, details: ALL_ON, trafficKey: 'k' }, BLANK_STYLE)
      // The heatmap is your own data, so it works offline too.
      expect(Object.keys(s.sources).sort()).toEqual(['heat', 'me', 'near', 'places'])
      expect(ids(s)).toEqual(['background', 'near-fill', 'near-line', 'heat', 'clusters', 'points', 'selected', 'me'])
      expect(s.projection).toEqual({ type: 'globe' })
      expect(layer(s, 'clusters').paint?.['circle-color']).toBe(LIGHT_THEME.cluster)
    }
  })
})

describe('restorePrefs', () => {
  it('falls back to defaults for missing or unknown values', () => {
    expect(restorePrefs(undefined)).toEqual({ basemap: 'light', details: DEFAULT_DETAILS, trafficKey: '' })
    expect(restorePrefs({ basemap: 'hybrid', details: { transit: true, bogus: true, globe: 'yes' }, trafficKey: 4 })).toEqual({
      basemap: 'light',
      details: { ...DEFAULT_DETAILS, transit: true },
      trafficKey: '',
    })
    expect(restorePrefs({ basemap: 'satellite', details: { globe: true }, trafficKey: 'k' })).toMatchObject({ basemap: 'satellite', trafficKey: 'k' })
  })
})
