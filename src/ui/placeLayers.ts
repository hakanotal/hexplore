import type { LayerSpecification, SourceSpecification } from 'maplibre-gl'

type FC = GeoJSON.FeatureCollection<GeoJSON.Geometry>

/** Colors for your own points, tuned per base map so they stay readable. */
export interface MapTheme {
  dark: boolean
  cluster: string
  clusterText: string
  clusterStroke: string
  /** Ring around the selected place. */
  ring: string
  /** Opacity of saved places that are neither visited nor want to go. */
  softOpacity: number
  /** Behind the globe when zoomed out. */
  space: string
}

export const LIGHT_THEME: MapTheme = {
  dark: false,
  cluster: '#0f172a',
  clusterText: '#ffffff',
  clusterStroke: '#ffffff',
  ring: '#0f172a',
  softOpacity: 0.55,
  space: '#dfe6ee',
}

export const DARK_THEME: MapTheme = {
  dark: true,
  cluster: '#f8fafc',
  clusterText: '#0f172a',
  clusterStroke: '#0f172a',
  ring: '#ffffff',
  softOpacity: 0.85,
  space: '#05070d',
}

export const PLACE_SOURCE_IDS = ['places', 'near', 'me'] as const

export interface PlaceData {
  places: FC
  near: FC
  me: FC
}

export function placeSources(data: PlaceData): Record<string, SourceSpecification> {
  return {
    places: { type: 'geojson', data: data.places, cluster: true, clusterRadius: 44, clusterMaxZoom: 14 },
    near: { type: 'geojson', data: data.near },
    me: { type: 'geojson', data: data.me },
  }
}

/** Your places, the radius ring and your location, always above the base map. */
export function placeLayers(theme: MapTheme, opts: { glyphs: boolean; selectedId: string | null }): LayerSpecification[] {
  const layers: LayerSpecification[] = [
    { id: 'near-fill', type: 'fill', source: 'near', paint: { 'fill-color': '#2563eb', 'fill-opacity': theme.dark ? 0.12 : 0.06 } },
    { id: 'near-line', type: 'line', source: 'near', paint: { 'line-color': theme.dark ? '#60a5fa' : '#2563eb', 'line-width': 1.5, 'line-dasharray': [2, 2] } },
    {
      id: 'clusters',
      type: 'circle',
      source: 'places',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': theme.cluster,
        'circle-opacity': theme.dark ? 0.92 : 0.82,
        'circle-radius': ['step', ['get', 'point_count'], 14, 25, 18, 100, 23, 500, 29],
        'circle-stroke-width': 2,
        'circle-stroke-color': theme.clusterStroke,
      },
    },
  ]
  if (opts.glyphs) {
    layers.push({
      id: 'cluster-count',
      type: 'symbol',
      source: 'places',
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12 },
      paint: { 'text-color': theme.clusterText },
    })
  }
  layers.push(
    // Visited: filled. Want to go: outlined. Other saved: soft fill.
    {
      id: 'points',
      type: 'circle',
      source: 'places',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 4, 12, 6, 16, 9],
        'circle-color': ['case', ['==', ['get', 'visited'], 1], ['get', 'color'], ['==', ['get', 'want'], 1], '#ffffff', ['get', 'color']],
        'circle-opacity': ['case', ['==', ['get', 'visited'], 1], 1, ['==', ['get', 'want'], 1], 1, theme.softOpacity],
        'circle-stroke-color': ['case', ['==', ['get', 'visited'], 1], '#ffffff', ['get', 'color']],
        'circle-stroke-width': ['case', ['==', ['get', 'want'], 1], 2.5, 1.5],
      },
    },
    {
      id: 'selected',
      type: 'circle',
      source: 'places',
      filter: ['==', ['get', 'id'], opts.selectedId ?? ''],
      paint: { 'circle-radius': 13, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': theme.ring, 'circle-stroke-width': 3 },
    },
    {
      id: 'me',
      type: 'circle',
      source: 'me',
      paint: { 'circle-radius': 7, 'circle-color': '#2563eb', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 },
    },
  )
  return layers
}
