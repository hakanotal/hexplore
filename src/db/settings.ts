import type { GeocoderId } from '../services/geocoder'
import { getDb } from './db'

export interface AppSettings {
  geocoder: Exclude<GeocoderId, 'fixture'>
  /** Overrides PLACES_API_KEY from .env. */
  googlePlacesKey: string
  openRouterKey: string
  chatModel: string
  classifyModel: string
  excludeNotesFromAI: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  geocoder: 'photon',
  googlePlacesKey: '',
  openRouterKey: '',
  chatModel: '',
  classifyModel: '',
  excludeNotesFromAI: false,
}

export async function loadSettings(): Promise<AppSettings> {
  const rows = await getDb().settings.toArray()
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value
  return out as unknown as AppSettings
}

export async function saveSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
  await getDb().settings.put({ key, value })
}

/** PLACES_API_KEY from .env is baked into the build; restrict the key to your domain in Google Cloud. */
export const ENV_GOOGLE_PLACES_KEY = ((import.meta.env.PLACES_API_KEY as string | undefined) ?? '').trim()

export function googlePlacesKey(settings: AppSettings): string {
  return settings.googlePlacesKey.trim() || ENV_GOOGLE_PLACES_KEY
}

/** Place Details calls allowed per calendar month, under the Pro tier's 5,000 free. */
export const GOOGLE_MONTHLY_LIMIT = 4500

export interface GoogleUsage {
  /** YYYY-MM, UTC */
  month: string
  calls: number
}

export async function googleUsage(now = Date.now()): Promise<GoogleUsage> {
  const month = new Date(now).toISOString().slice(0, 7)
  const row = (await getDb().settings.get('googleUsage'))?.value as GoogleUsage | undefined
  return row?.month === month ? row : { month, calls: 0 }
}

/** Counts one billable call; false once this month's limit is reached. */
export async function takeGoogleCall(now = Date.now(), limit = GOOGLE_MONTHLY_LIMIT): Promise<boolean> {
  const db = getDb()
  return db.transaction('rw', db.settings, async () => {
    const usage = await googleUsage(now)
    if (usage.calls >= limit) return false
    await db.settings.put({ key: 'googleUsage', value: { month: usage.month, calls: usage.calls + 1 } })
    return true
  })
}

/** Which geocoder resolves the current data. Sample imports use the offline fixture. */
export async function activeGeocoder(): Promise<GeocoderId> {
  const db = getDb()
  const [sample, settings] = await Promise.all([db.settings.get('dataSource'), loadSettings()])
  return sample?.value === 'sample' ? 'fixture' : settings.geocoder
}

export async function setDataSource(source: 'sample' | 'takeout' | 'demo'): Promise<void> {
  await getDb().settings.put({ key: 'dataSource', value: source })
}

export async function clearAllData(): Promise<void> {
  const db = getDb()
  await Promise.all(db.tables.filter((t) => t.name !== 'settings').map((t) => t.clear()))
  await db.settings.delete('dataSource')
  await db.settings.delete('sampleWorldSize')
}
