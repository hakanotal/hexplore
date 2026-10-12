import type { ExpressionSpecification, LayerSpecification, SourceSpecification } from 'maplibre-gl'

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

export const PLACE_SOURCE_IDS = ['places', 'heat', 'near', 'candidates', 'me'] as const

export interface PlaceData {
  places: FC
  /** Visited places among the results, unclustered, for the heatmap. */
  heat: FC
  near: FC
  /** Numbered alternatives for the place being checked in the review queue. */
  candidates: FC
  me: FC
}

export function placeSources(data: PlaceData, opts: { cluster: boolean }): Record<string, SourceSpecification> {
  return {
    places: opts.cluster ? { type: 'geojson', data: data.places, cluster: true, clusterRadius: 44, clusterMaxZoom: 14 } : { type: 'geojson', data: data.places },
    heat: { type: 'geojson', data: data.heat },
    candidates: { type: 'geojson', data: data.candidates },
    near: { type: 'geojson', data: data.near },
    me: { type: 'geojson', data: data.me },
  }
}

/** Density of visited places: one blue, transparent where there are none, darker where there are many. */
function heatmap(theme: MapTheme): LayerSpecification {
  return {
    id: 'heat',
    type: 'heatmap',
    source: 'heat',
    maxzoom: 17,
    paint: {
      'heatmap-weight': 1,
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 9, 1.2, 15, 2],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 3, 6, 10, 10, 18, 15, 30],
      'heatmap-color': [
        'interpolate',
        ['linear'],
        ['heatmap-density'],
        0,
        'rgba(37,99,235,0)',
        0.15,
        theme.dark ? 'rgba(147,197,253,0.55)' : 'rgba(147,197,253,0.6)',
        0.4,
        '#60a5fa',
        0.7,
        '#2563eb',
        1,
        theme.dark ? '#dbeafe' : '#1e3a8a',
      ],
      // Points take over close in.
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.85, 16, 0.3],
    },
  }
}

/** Your places, the radius ring and your location, always above the base map. */
export function placeLayers(theme: MapTheme, opts: { glyphs: boolean; selectedId: string | null; heatmap?: boolean; near?: boolean }): LayerSpecification[] {
  const unclustered: ExpressionSpecification = ['!', ['has', 'point_count']]
  const layers: LayerSpecification[] = [
    { id: 'near-fill', type: 'fill', source: 'near', paint: { 'fill-color': '#2563eb', 'fill-opacity': theme.dark ? 0.12 : 0.06 } },
    { id: 'near-line', type: 'line', source: 'near', paint: { 'line-color': theme.dark ? '#60a5fa' : '#2563eb', 'line-width': 1.5, 'line-dasharray': [2, 2] } },
    // Inside the near-me ring, places you want to go get a halo.
    {
      id: 'near-want',
      type: 'circle',
      source: 'places',
      filter: ['all', unclustered, ['==', ['get', 'want'], 1]],
      layout: { visibility: opts.near ? 'visible' : 'none' },
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 11, 16, 18], 'circle-color': '#2563eb', 'circle-opacity': theme.dark ? 0.35 : 0.22, 'circle-blur': 0.3 },
    },
    ...(opts.heatmap ? [heatmap(theme)] : []),
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
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 4, 12, 6, 14, 9, 16, 11, 18, 13],
        'circle-color': ['case', ['==', ['get', 'visited'], 1], ['get', 'color'], ['==', ['get', 'want'], 1], '#ffffff', ['get', 'color']],
        'circle-opacity': ['case', ['==', ['get', 'visited'], 1], 1, ['==', ['get', 'want'], 1], 1, theme.softOpacity],
        'circle-stroke-color': ['case', ['==', ['get', 'visited'], 1], '#ffffff', ['get', 'color']],
        'circle-stroke-width': ['case', ['==', ['get', 'want'], 1], 2.5, 1.5],
      },
    },
    // Category pictograms once there is room for them, drawn on demand (see categoryIcons.ts).
    {
      id: 'point-icons',
      type: 'symbol',
      source: 'places',
      minzoom: 14,
      filter: unclustered,
      layout: {
        'icon-image': ['concat', 'hx-cat-', ['get', 'category'], '-', ['case', ['==', ['get', 'want'], 1], 'c', 'w']],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.7, 16, 0.85, 18, 1],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
    {
      id: 'candidate-dots',
      type: 'circle',
      source: 'candidates',
      paint: { 'circle-radius': 10, 'circle-color': '#d97706', 'circle-stroke-color': theme.dark ? '#0f172a' : '#ffffff', 'circle-stroke-width': 2 },
    },
    ...(opts.glyphs
      ? [
          {
            id: 'candidate-labels',
            type: 'symbol',
            source: 'candidates',
            layout: { 'text-field': ['to-string', ['get', 'n']], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true },
            paint: { 'text-color': '#ffffff' },
          } satisfies LayerSpecification,
        ]
      : []),
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
