import type { ListRole } from '../domain/types'
import type { PlaceView } from '../query/placeView'
import { haversineKm } from '../pipeline/similarity'

export function areaLine(v: PlaceView): string {
  const p = v.place
  return [p.neighborhood, p.city, p.city ? undefined : p.country].filter(Boolean).join(', ')
}

export function distanceLabel(v: PlaceView, from: { lat: number; lng: number } | null): string | null {
  if (!from || v.lat === undefined || v.lng === undefined) return null
  const km = haversineKm(from, { lat: v.lat, lng: v.lng })
  return km < 1 ? `${Math.round(km * 1000)} m` : km < 100 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}

export const ROLE_LABEL: Record<ListRole, string> = {
  visited: 'Visited',
  wantToGo: 'Want to go',
  favorite: 'Favorite',
  other: 'Other',
}

const SOURCE_LABEL: Record<string, string> = {
  fid: 'Google place ID',
  google: 'Google Places',
  url: 'Google Maps link',
  takeout: 'Google Takeout',
}

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source
}

export function formatDate(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function googleMapsUrl(v: PlaceView): string {
  if (v.place.googleUrl) return v.place.googleUrl
  if (v.lat !== undefined) return `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.place.title)}`
}

export function directionsUrl(v: PlaceView, provider: 'google' | 'apple'): string {
  const dest = v.lat !== undefined ? `${v.lat},${v.lng}` : encodeURIComponent(v.place.title)
  return provider === 'apple' ? `https://maps.apple.com/?daddr=${dest}` : `https://www.google.com/maps/dir/?api=1&destination=${dest}`
}

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
