import type { ExpressionSpecification, LayerSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl'
import type { BasemapId, DetailId, MapDetails } from '../state/mapPrefs'
import { DARK_THEME, LIGHT_THEME, placeLayers, placeSources, type MapTheme, type PlaceData } from './placeLayers'

const OPENFREEMAP = 'https://tiles.openfreemap.org/styles'
export const OPENFREEMAP_STYLE = `${OPENFREEMAP}/positron`

/** Offline style for tests and e2e runs: no tiles, no glyphs, no network. */
export const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8edf2' } }],
}

export interface Basemap {
  id: BasemapId
  label: string
  /** The OpenFreeMap style it starts from. */
  style: string
  dark: boolean
}

export const BASEMAPS: Basemap[] = [
  { id: 'light', label: 'Light', style: `${OPENFREEMAP}/positron`, dark: false },
  { id: 'streets', label: 'Streets', style: `${OPENFREEMAP}/liberty`, dark: false },
  { id: 'dark', label: 'Dark', style: `${OPENFREEMAP}/dark`, dark: true },
  // Imagery with Positron's labels, borders and main roads on top.
  { id: 'satellite', label: 'Satellite', style: `${OPENFREEMAP}/positron`, dark: true },
]

const BASEMAP_BY_ID = Object.fromEntries(BASEMAPS.map((b) => [b.id, b])) as Record<BasemapId, Basemap>

/** The base style to load for a map type, or the offline style when VITE_MAP_STYLE=blank. */
export function baseStyleFor(id: BasemapId): string | StyleSpecification {
  const configured = import.meta.env.VITE_MAP_STYLE as string | undefined
  if (configured === 'blank') return BLANK_STYLE
  if (configured && id === 'light') return configured
  return BASEMAP_BY_ID[id].style
}

// Free sources, none needs a key. Esri allows non-commercial use of its imagery
// with attribution; Mapterhorn is open terrain data, global to zoom 12.
const IMAGERY: SourceSpecification = {
  type: 'raster',
  tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  tileSize: 256,
  maxzoom: 19,
  attribution: 'Imagery © <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
}

const DEM: SourceSpecification = {
  type: 'raster-dem',
  tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
  tileSize: 512,
  maxzoom: 12,
  encoding: 'terrarium',
  attribution: '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
}

export const TRAFFIC_SOURCE = 'hx-traffic'

function trafficSource(key: string, dark: boolean): SourceSpecification {
  const style = dark ? 'relative0-dark' : 'relative0'
  return {
    type: 'raster',
    tiles: [`https://api.tomtom.com/traffic/map/4/tile/flow/${style}/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}&tileSize=512`],
    tileSize: 512,
    maxzoom: 22,
    attribution: 'Traffic © <a href="https://www.tomtom.com/">TomTom</a>',
  }
}

/** OpenMapTiles vector source shared by every OpenFreeMap style. */
const OMT = 'openmaptiles'

export interface ComposeInput {
  basemap: BasemapId
  details: MapDetails
  trafficKey: string
  /** False for the offline style: never add a source that fetches tiles. */
  network: boolean
  data: PlaceData
  selectedId: string | null
}

export function themeFor(basemap: BasemapId, network: boolean): MapTheme {
  return network && BASEMAP_BY_ID[basemap].dark ? DARK_THEME : LIGHT_THEME
}

/**
 * Builds the full map style from a fetched base style: the chosen map type,
 * the detail layers, then your places on top. Pure, so it also runs on every
 * toggle and MapLibre diffs the result against what is on screen.
 */
export function composeStyle(base: StyleSpecification, input: ComposeInput): StyleSpecification {
  const { basemap, details, network } = input
  const theme = themeFor(basemap, network)
  const style = structuredClone(base)
  const sources: Record<string, SourceSpecification> = { ...style.sources }
  // A quiet base map: drop POI icons so your own points stand out.
  let layers = style.layers.filter((l) => !/poi/i.test(l.id))
  const satellite = network && basemap === 'satellite'
  if (satellite) {
    sources['hx-imagery'] = IMAGERY
    layers = toHybrid(layers)
  }

  const vector = network && OMT in sources
  const glyphs = !!style.glyphs
  const sprite = !!style.sprite
  const applied: DetailId[] = []

  if (details.terrain && network) {
    sources['hx-dem'] = DEM
    const at = satellite ? layers.findIndex((l) => l.id === 'hx-imagery') + 1 : firstIndex(layers, (l) => l.type === 'line' || l.type === 'symbol' || l.type === 'fill-extrusion')
    layers.splice(at, 0, hillshade(theme, satellite))
    applied.push('terrain')
  }

  // Above roads, below labels.
  const middle: LayerSpecification[] = []
  if (details.traffic && network && input.trafficKey) {
    sources[TRAFFIC_SOURCE] = trafficSource(input.trafficKey, theme.dark)
    middle.push({ id: 'hx-traffic', type: 'raster', source: TRAFFIC_SOURCE, minzoom: 5, paint: { 'raster-opacity': 0.9 } })
    applied.push('traffic')
  }
  if (details.transit && vector) middle.push(...transitLines(theme))
  if (details.buildings && vector) {
    middle.push(buildings3d(theme, satellite))
    applied.push('buildings')
  }
  layers.splice(firstIndex(layers, (l) => l.type === 'symbol'), 0, ...middle)

  // Stations go above the base labels so they win label collisions.
  if (details.transit && vector) {
    if (glyphs || sprite) layers.push(transitStations(theme, { glyphs, sprite }))
    applied.push('transit')
  }

  Object.assign(sources, placeSources(input.data, { cluster: details.cluster }))
  // Cluster layers stay in the style either way; without clustering they simply match nothing.
  layers.push(...placeLayers(theme, { glyphs, selectedId: input.selectedId, heatmap: details.heatmap }))
  if (details.heatmap) applied.push('heatmap')
  if (details.cluster) applied.push('cluster')

  const out: StyleSpecification = {
    ...style,
    sources,
    layers,
    projection: { type: details.globe ? 'globe' : 'mercator' },
    metadata: { ...(style.metadata as object | undefined), 'hexplore:basemap': basemap, 'hexplore:details': details.globe ? [...applied, 'globe'] : applied },
  }
  if (details.globe) out.sky = { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] }
  else delete out.sky
  return out
}

function firstIndex(layers: LayerSpecification[], test: (l: LayerSpecification) => boolean): number {
  const i = layers.findIndex(test)
  return i === -1 ? layers.length : i
}

const HYBRID_ROADS: Record<string, { color: string; width: ExpressionSpecification }> = {
  highway_minor: { color: 'rgba(255,255,255,0.28)', width: ['interpolate', ['linear'], ['zoom'], 14, 0.5, 18, 2.5] },
  highway_major_inner: { color: 'rgba(255,255,255,0.5)', width: ['interpolate', ['linear'], ['zoom'], 10, 0.6, 14, 1.6, 18, 4] },
  highway_motorway_inner: { color: 'rgba(255,214,110,0.75)', width: ['interpolate', ['linear'], ['zoom'], 6, 0.6, 12, 1.6, 18, 5] },
  highway_motorway_bridge_inner: { color: 'rgba(255,214,110,0.75)', width: ['interpolate', ['linear'], ['zoom'], 6, 0.6, 12, 1.6, 18, 5] },
}

/** Satellite imagery under Positron's labels, borders and a light road overlay. */
function toHybrid(layers: LayerSpecification[]): LayerSpecification[] {
  const out: LayerSpecification[] = [
    { id: 'hx-imagery-bg', type: 'background', paint: { 'background-color': '#0b1120' } },
    { id: 'hx-imagery', type: 'raster', source: 'hx-imagery', paint: { 'raster-fade-duration': 150 } },
  ]
  for (const l of layers) {
    if (l.type === 'symbol') {
      out.push(l.layout?.['text-field'] ? { ...l, paint: { ...l.paint, 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.75)', 'text-halo-width': 1.3, 'text-halo-blur': 0.5 } } : l)
    } else if (l.type === 'line' && l['source-layer'] === 'boundary') {
      out.push({ ...l, paint: { ...l.paint, 'line-color': 'rgba(255,255,255,0.6)' } })
    } else if (l.type === 'line' && HYBRID_ROADS[l.id]) {
      const road = HYBRID_ROADS[l.id]!
      out.push({ ...l, paint: { 'line-color': road.color, 'line-width': road.width } })
    }
  }
  return out
}

function hillshade(theme: MapTheme, onImagery: boolean): LayerSpecification {
  return {
    id: 'hx-hillshade',
    type: 'hillshade',
    source: 'hx-dem',
    paint: {
      'hillshade-method': 'igor',
      'hillshade-exaggeration': onImagery ? 0.25 : theme.dark ? 0.5 : 0.4,
      'hillshade-shadow-color': theme.dark ? '#000000' : '#334155',
      'hillshade-highlight-color': theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.6)',
      'hillshade-accent-color': theme.dark ? '#000000' : '#1e293b',
    },
  }
}

// Metro violet, light rail cyan, tram orange; OpenMapTiles has no line colors.
const TRANSIT_COLOR: ExpressionSpecification = ['match', ['get', 'subclass'], 'light_rail', '#0891b2', 'tram', '#ea580c', ['monorail', 'funicular'], '#be185d', '#7c3aed']
const NO_SERVICE_TRACKS: ExpressionSpecification = ['!', ['has', 'service']]

function transitLines(theme: MapTheme): LayerSpecification[] {
  const rail = theme.dark ? '#cbd5e1' : '#334155'
  const sleeper = theme.dark ? '#0f172a' : '#ffffff'
  return [
    {
      id: 'hx-transit-ferry',
      type: 'line',
      source: OMT,
      'source-layer': 'transportation',
      minzoom: 10,
      filter: ['==', ['get', 'class'], 'ferry'],
      // Busy harbors (Istanbul, Hong Kong) draw dozens of routes; keep them faint.
      paint: { 'line-color': '#0284c7', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 1.4], 'line-dasharray': [4, 3], 'line-opacity': 0.45 },
    },
    {
      id: 'hx-transit-rail',
      type: 'line',
      source: OMT,
      'source-layer': 'transportation',
      filter: ['all', ['==', ['get', 'class'], 'rail'], NO_SERVICE_TRACKS],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': rail,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 10, 1.4, 14, 2.6, 18, 4.5],
        'line-opacity': ['case', ['==', ['get', 'brunnel'], 'tunnel'], 0.5, 1],
      },
    },
    {
      id: 'hx-transit-rail-dash',
      type: 'line',
      source: OMT,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: ['all', ['==', ['get', 'class'], 'rail'], NO_SERVICE_TRACKS, ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: { 'line-color': sleeper, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 18, 2], 'line-dasharray': [3, 3] },
    },
    {
      id: 'hx-transit-metro',
      type: 'line',
      source: OMT,
      'source-layer': 'transportation',
      minzoom: 9,
      filter: ['all', ['==', ['get', 'class'], 'transit'], NO_SERVICE_TRACKS],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': TRANSIT_COLOR,
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 12, 2, 15, 3.5, 18, 6],
        'line-opacity': ['case', ['==', ['get', 'brunnel'], 'tunnel'], 0.75, 1],
      },
    },
  ]
}

// OpenMapTiles poi classes seen in OpenFreeMap tiles: railway (station, halt,
// subway, tram_stop), bus (bus_stop, bus_station), ferry_terminal, aerialway.
const STATION_ICON: ExpressionSpecification = [
  'match',
  ['get', 'class'],
  'bus',
  'bus',
  'ferry_terminal',
  'ferry',
  'aerialway',
  'aerialway',
  ['match', ['get', 'subclass'], 'subway', 'railway_metro', 'tram_stop', 'railway_light', 'railway'],
]

function transitStations(theme: MapTheme, opts: { glyphs: boolean; sprite: boolean }): LayerSpecification {
  const bus: ExpressionSpecification = ['==', ['get', 'class'], 'bus']
  const name: ExpressionSpecification = ['coalesce', ['get', 'name_en'], ['get', 'name']]
  return {
    id: 'hx-transit-stations',
    type: 'symbol',
    source: OMT,
    'source-layer': 'poi',
    minzoom: 12,
    // Bus stops are dense; show them only close in.
    filter: ['any', ['match', ['get', 'class'], ['railway', 'ferry_terminal', 'aerialway'], true, false], ['all', bus, ['>=', ['zoom'], 15]]],
    layout: {
      ...(opts.sprite ? { 'icon-image': STATION_ICON, 'icon-size': 0.8 } : {}),
      ...(opts.glyphs
        ? {
            // Bus stops repeat the same name on every corner: icon only until close in.
            // (A zoom step must be the outermost expression.)
            'text-field': ['step', ['zoom'], '', 13, ['case', bus, '', name], 17, name],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-anchor': opts.sprite ? 'left' : 'center',
            'text-offset': opts.sprite ? [0.9, 0] : [0, 0],
            'text-max-width': 9,
            'text-optional': true,
          }
        : {}),
    },
    paint: {
      'text-color': theme.dark ? '#bfdbfe' : '#1d4ed8',
      'text-halo-color': theme.dark ? 'rgba(0,0,0,0.8)' : '#ffffff',
      'text-halo-width': 1.2,
    },
  }
}

function buildings3d(theme: MapTheme, onImagery: boolean): LayerSpecification {
  return {
    id: 'hx-buildings-3d',
    type: 'fill-extrusion',
    source: OMT,
    'source-layer': 'building',
    minzoom: 14,
    filter: ['!=', ['get', 'hide_3d'], true],
    paint: {
      'fill-extrusion-color': onImagery ? '#e2e8f0' : theme.dark ? '#3b4252' : '#d4d2cb',
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, ['coalesce', ['get', 'render_height'], 0]],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': onImagery ? 0.75 : 0.9,
    },
  }
}
