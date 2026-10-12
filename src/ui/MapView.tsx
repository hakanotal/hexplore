import { useEffect, useRef, useState } from 'react'
import { GeoJSONSource, LngLatBounds, Map as MlMap, NavigationControl, setWorkerUrl, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { categoryColor } from '../domain/taxonomy'
import type { PlaceView } from '../query/placeView'
import { useMapPrefs, type DetailId } from '../state/mapPrefs'
import { useApp } from '../state/store'
import { baseStyleFor, BLANK_STYLE, composeStyle, themeFor, TRAFFIC_SOURCE } from './mapStyle'
import type { PlaceData } from './placeLayers'

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

function visitedPoints(items: PlaceView[]): FC {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = []
  for (const v of items) if (v.visited && v.lat !== undefined && v.lng !== undefined) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [v.lng, v.lat] }, properties: {} })
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

  // The latest data for each of our sources, so a style swap keeps your points.
  const dataRef = useRef<PlaceData>({ places: EMPTY, heat: EMPTY, near: EMPTY, me: EMPTY })
  const selectedRef = useRef<string | null>(null)
  const basemap = useMapPrefs((s) => s.basemap)
  const space = themeFor(basemap, typeof baseStyleFor(basemap) === 'string').space

  useEffect(() => {
    if (!container.current || !webglAvailable()) return
    let map: MlMap
    try {
      map = new MlMap({
        container: container.current,
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

    // Fetched base styles by URL, so toggling a detail only diffs, never refetches.
    const bases = new Map<string, StyleSpecification>()
    let offline = false
    let styleLoaded = false
    const applyStyle = () => {
      const { basemap, details, trafficKey, trafficError } = useMapPrefs.getState()
      const base = offline ? BLANK_STYLE : baseStyleFor(basemap)
      const network = typeof base === 'string'
      // A rejected key drops the layer instead of failing on every tile.
      const compose = (style: StyleSpecification) =>
        composeStyle(style, { basemap, details, trafficKey: trafficError ? '' : trafficKey, network, data: dataRef.current, selectedId: selectedRef.current })
      const ready = typeof base === 'string' ? bases.get(base) : base
      // Only an unfetched URL goes through transformStyle: MapLibre holds such a
      // swap until the current style loads, which a failed one never does.
      if (ready) map.setStyle(compose(ready))
      else {
        map.setStyle(base, {
          transformStyle: (_prev, next) => {
            bases.set(base as string, next)
            return compose(next)
          },
        })
      }
    }
    applyStyle()
    map.on('style.load', () => (styleLoaded = true))

    const unsubscribe = useMapPrefs.subscribe((s, prev) => {
      if (s.basemap === prev.basemap && s.details === prev.details && s.trafficKey === prev.trafficKey && s.trafficError === prev.trafficError) return
      offline = false
      applyStyle()
      const turned = (id: DetailId) => s.details[id] !== prev.details[id]
      // 3D buildings need a tilt to read; flatten again when they go.
      if (turned('buildings') && s.details.buildings && map.getZoom() >= 14) map.easeTo({ pitch: 50, duration: 600 })
      if (turned('buildings') && !s.details.buildings && map.getPitch() > 0) map.easeTo({ pitch: 0, bearing: 0, duration: 600 })
    })

    map.on('load', () => {
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
    map.on('error', (e) => {
      const { sourceId } = e as unknown as { sourceId?: string }
      const status = (e.error as { status?: number }).status
      if (sourceId === TRAFFIC_SOURCE && (status === 401 || status === 403)) {
        useMapPrefs.getState().setTrafficError('TomTom did not accept this key.')
        return
      }
      console.warn('Map error', e.error?.message)
      // If the base style cannot load (offline first start, blocked network),
      // fall back to a plain background so your places still render. Tile
      // errors carry a sourceId and leave the style alone.
      if (!styleLoaded && !offline && !sourceId) {
        offline = true
        applyStyle()
      }
    })

    return () => {
      unsubscribe()
      useApp.setState({ pickPoint: null })
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Rebuild the source from the filtered set; stays well under 50 ms at 10k places.
  useEffect(() => {
    dataRef.current.places = toGeoJSON(result)
    dataRef.current.heat = visitedPoints(result)
    if (loaded) {
      mapRef.current?.getSource<GeoJSONSource>('places')?.setData(dataRef.current.places)
      mapRef.current?.getSource<GeoJSONSource>('heat')?.setData(dataRef.current.heat)
    }
  }, [loaded, result])

  useEffect(() => {
    selectedRef.current = selectedId
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
    dataRef.current.me = userLocation
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [userLocation.lng, userLocation.lat] }, properties: {} }] }
      : EMPTY
    dataRef.current.near = near ? circlePolygon(near, near.km) : EMPTY
    map.getSource<GeoJSONSource>('me')?.setData(dataRef.current.me)
    map.getSource<GeoJSONSource>('near')?.setData(dataRef.current.near)
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
      <div ref={container} className="h-full w-full" style={{ background: space }} data-testid="map" data-loaded={loaded ? 'true' : 'false'} data-basemap={basemap} />
      {error && (
        <div className="absolute inset-x-4 top-24 rounded-lg bg-white/90 p-3 text-sm text-slate-700 shadow">
          The map could not start ({error}). Search, filters and the list still work.
        </div>
      )}
    </div>
  )
}
