import { useEffect, useRef, useState } from 'react'
import { GeoJSONSource, LngLatBounds, Map as MlMap, NavigationControl, setWorkerUrl, type GeoJSONSourceSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { categoryColor } from '../domain/taxonomy'
import type { PlaceView } from '../query/placeView'
import { useApp } from '../state/store'
import { BLANK_STYLE, resolveMapStyle } from './mapStyle'

setWorkerUrl(workerUrl)

type FC = GeoJSON.FeatureCollection<GeoJSON.Geometry>

function toGeoJSON(items: PlaceView[]): FC {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = []
  for (const v of items) {
    if (v.lat === undefined || v.lng === undefined) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
      properties: { id: v.id, color: categoryColor(v.place.category), visited: v.visited ? 1 : 0, want: v.wantToGo ? 1 : 0 },
    })
  }
  return { type: 'FeatureCollection', features }
}

function circlePolygon(center: { lat: number; lng: number }, km: number, steps = 64): FC {
  const coords: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI
    const dLat = (km / 111.32) * Math.cos(a)
    const dLng = (km / (111.32 * Math.cos((center.lat * Math.PI) / 180))) * Math.sin(a)
    coords.push([center.lng + dLng, center.lat + dLat])
  }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} }] }
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

const EMPTY: FC = { type: 'FeatureCollection', features: [] }

const SHEET_PADDING = { peek: 140, half: 0.5, full: 0.5 } as const

export function MapView() {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(() => (webglAvailable() ? null : 'WebGL is not available'))

  const result = useApp((s) => s.result)
  const selectedId = useApp((s) => s.selectedId)
  const byId = useApp((s) => s.byId)
  const userLocation = useApp((s) => s.userLocation)
  const near = useApp((s) => s.filters.near)
  const fitRequest = useApp((s) => s.fitRequest)
  const sheet = useApp((s) => s.sheet)

  useEffect(() => {
    if (!container.current || !webglAvailable()) return
    let map: MlMap
    try {
      map = new MlMap({
        container: container.current,
        style: resolveMapStyle(),
        center: [20, 30],
        zoom: 1.5,
        attributionControl: { compact: true },
      })
    } catch (err) {
      void Promise.resolve().then(() => setError(err instanceof Error ? err.message : 'Map failed to start'))
      return
    }
    mapRef.current = map
    if (import.meta.env.MODE !== 'production') (window as unknown as { __map?: MlMap }).__map = map
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')

    map.on('load', () => {
      // Quiet base map: hide POI labels so your own points stand out.
      for (const layer of map.getStyle().layers ?? []) {
        if (/poi/i.test(layer.id)) map.setLayoutProperty(layer.id, 'visibility', 'none')
      }
      const hasGlyphs = !!map.getStyle().glyphs

      map.addSource('places', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 44, clusterMaxZoom: 14 } satisfies GeoJSONSourceSpecification)
      map.addSource('near', { type: 'geojson', data: EMPTY })
      map.addSource('me', { type: 'geojson', data: EMPTY })

      map.addLayer({ id: 'near-fill', type: 'fill', source: 'near', paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.06 } })
      map.addLayer({ id: 'near-line', type: 'line', source: 'near', paint: { 'line-color': '#2563eb', 'line-width': 1.5, 'line-dasharray': [2, 2] } })
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'places',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#0f172a',
          'circle-opacity': 0.82,
          'circle-radius': ['step', ['get', 'point_count'], 14, 25, 18, 100, 23, 500, 29],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })
      if (hasGlyphs) {
        map.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'places',
          filter: ['has', 'point_count'],
          layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12 },
          paint: { 'text-color': '#ffffff' },
        })
      }
      // Visited: filled. Want to go: outlined. Other saved: soft fill.
      map.addLayer({
        id: 'points',
        type: 'circle',
        source: 'places',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 4, 12, 6, 16, 9],
          'circle-color': ['case', ['==', ['get', 'visited'], 1], ['get', 'color'], ['==', ['get', 'want'], 1], '#ffffff', ['get', 'color']],
          'circle-opacity': ['case', ['==', ['get', 'visited'], 1], 1, ['==', ['get', 'want'], 1], 1, 0.55],
          'circle-stroke-color': ['case', ['==', ['get', 'visited'], 1], '#ffffff', ['get', 'color']],
          'circle-stroke-width': ['case', ['==', ['get', 'want'], 1], 2.5, 1.5],
        },
      })
      map.addLayer({
        id: 'selected',
        type: 'circle',
        source: 'places',
        filter: ['==', ['get', 'id'], ''],
        paint: { 'circle-radius': 13, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#0f172a', 'circle-stroke-width': 3 },
      })
      map.addLayer({
        id: 'me',
        type: 'circle',
        source: 'me',
        paint: { 'circle-radius': 7, 'circle-color': '#2563eb', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 },
      })

      map.on('click', 'clusters', async (e) => {
        const f = e.features?.[0]
        if (!f) return
        const source = map.getSource<GeoJSONSource>('places')!
        const zoom = await source.getClusterExpansionZoom(f.properties.cluster_id as number)
        map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom })
      })
      map.on('click', 'points', (e) => {
        const id = e.features?.[0]?.properties.id as string | undefined
        if (id) useApp.getState().select(id)
      })
      for (const layer of ['clusters', 'points']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
      }
      useApp.setState({
        pickPoint: (x, y) => {
          const rect = map.getContainer().getBoundingClientRect()
          const ll = map.unproject([x - rect.left, y - rect.top])
          return { lat: ll.lat, lng: ll.lng }
        },
      })
      setLoaded(true)
    })

    const reportView = () => {
      const c = map.getCenter()
      const b = map.getBounds()
      useApp.getState().setMapView({ lat: c.lat, lng: c.lng }, [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
    }
    map.on('moveend', reportView)
    // If the tile style cannot load (offline first start, blocked network), fall
    // back to a plain background so your places still render.
    let fellBack = false
    map.on('error', (e) => {
      console.warn('Map error', e.error?.message)
      if (!fellBack && !map.isStyleLoaded() && typeof resolveMapStyle() === 'string') {
        fellBack = true
        map.setStyle(BLANK_STYLE)
      }
    })

    return () => {
      useApp.setState({ pickPoint: null })
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Rebuild the source from the filtered set; stays well under 50 ms at 10k places.
  useEffect(() => {
    if (!loaded) return
    mapRef.current?.getSource<GeoJSONSource>('places')?.setData(toGeoJSON(result))
  }, [loaded, result])

  useEffect(() => {
    if (!loaded) return
    mapRef.current?.setFilter('selected', ['==', ['get', 'id'], selectedId ?? ''])
    const v = selectedId ? byId.get(selectedId) : undefined
    const map = mapRef.current
    if (map && v?.lat !== undefined && v.lng !== undefined) {
      const bounds = map.getBounds()
      if (!bounds.contains([v.lng, v.lat]) || map.getZoom() < 12) {
        map.easeTo({ center: [v.lng, v.lat], zoom: Math.max(map.getZoom(), 14), padding: { bottom: window.innerHeight * 0.45, top: 0, left: 0, right: 0 } })
      }
    }
  }, [loaded, selectedId, byId])

  useEffect(() => {
    if (!loaded) return
    const map = mapRef.current!
    map.getSource<GeoJSONSource>('me')?.setData(
      userLocation
        ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [userLocation.lng, userLocation.lat] }, properties: {} }] }
        : EMPTY,
    )
    map.getSource<GeoJSONSource>('near')?.setData(near ? circlePolygon(near, near.km) : EMPTY)
    if (near) {
      const ring = circlePolygon(near, near.km).features[0]!.geometry as GeoJSON.Polygon
      const b = new LngLatBounds()
      for (const c of ring.coordinates[0]!) b.extend(c as [number, number])
      map.fitBounds(b, { padding: { top: 80, bottom: window.innerHeight * 0.45, left: 30, right: 30 }, maxZoom: 16 })
    }
  }, [loaded, userLocation, near])

  useEffect(() => {
    if (!loaded || !fitRequest) return
    const map = mapRef.current!
    const located = useApp.getState().result.filter((v) => v.lat !== undefined)
    if (!located.length) return
    const b = new LngLatBounds()
    for (const v of located) b.extend([v.lng!, v.lat!])
    const pad = SHEET_PADDING[useApp.getState().sheet]
    const bottom = pad < 1 ? window.innerHeight * pad : pad
    map.fitBounds(b, { padding: { top: 90, bottom, left: 40, right: 40 }, maxZoom: 15, duration: 600 })
  }, [loaded, fitRequest])

  useEffect(() => {
    mapRef.current?.resize()
  }, [sheet])

  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" data-testid="map" data-loaded={loaded ? 'true' : 'false'} />
      {error && (
        <div className="absolute inset-x-4 top-24 rounded-lg bg-white/90 p-3 text-sm text-slate-700 shadow">
          The map could not start ({error}). Search, filters and the list still work.
        </div>
      )}
    </div>
  )
}
