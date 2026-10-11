import type { GeocoderId } from '../services/geocoder'
import { getDb } from './db'

export interface AppSettings {
  geocoder: Exclude<GeocoderId, 'fixture'>
  openRouterKey: string
  chatModel: string
  classifyModel: string
  excludeNotesFromAI: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  geocoder: 'photon',
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
