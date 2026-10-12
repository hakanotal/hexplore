import * as Comlink from 'comlink'
import { getDb } from '../db/db'
import { importTakeout, type ImportOutcome } from '../db/importRepo'
import { buildSampleTakeout } from '../dev/sampleTakeout'
import { buildDemoData } from '../dev/demoData'
import { FixtureGeocoder } from '../dev/fixtureGeocoder'
import { generateWorld } from '../dev/world'
import { runPipeline, type PipelineProgress, type PipelineServices } from '../pipeline/runner'
import type { GeocoderId } from '../services/geocoder'
import { NominatimGeocoder } from '../services/nominatim'
import { PhotonGeocoder } from '../services/photon'
import { GooglePlaces } from '../services/googlePlaces'
import { googlePlacesKey, loadSettings, takeGoogleCall } from '../db/settings'

// Heavy jobs off the main thread: Takeout parsing and merging, the enrichment
// pipeline, and demo data generation. Opens its own connection to the database.

let controller: AbortController | null = null

async function fixtureServices(): Promise<PipelineServices> {
  const size = ((await getDb().settings.get('sampleWorldSize'))?.value as number | undefined) ?? 500
  const fixture = new FixtureGeocoder(generateWorld(size))
  return { geocoder: fixture, reverse: fixture }
}

async function servicesFor(id: GeocoderId): Promise<PipelineServices> {
  if (id === 'fixture') return fixtureServices()
  const nominatim = new NominatimGeocoder()
  const key = googlePlacesKey(await loadSettings())
  return {
    geocoder: id === 'nominatim' ? nominatim : new PhotonGeocoder(),
    reverse: nominatim,
    places: key ? new GooglePlaces(key, { take: () => takeGoogleCall() }) : undefined,
  }
}

const api = {
  async importFiles(files: { name: string; data: Uint8Array }[]): Promise<ImportOutcome> {
    return importTakeout(files.map((f) => ({ path: f.name, data: f.data })))
  },

  /** Imports a synthetic Takeout through the real import path. */
  async importSample(count: number, revision: 1 | 2): Promise<ImportOutcome> {
    const sample = buildSampleTakeout({ count, revision })
    await getDb().settings.put({ key: 'sampleWorldSize', value: sample.world.length + 50 })
    return importTakeout(Object.entries(sample.files).map(([path, data]) => ({ path, data })))
  },

  async seedDemo(count: number): Promise<void> {
    const db = getDb()
    const { places, lists, memberships } = buildDemoData(count)
    await db.transaction('rw', [db.places, db.lists, db.memberships], async () => {
      await db.places.bulkPut(places)
      await db.lists.bulkPut(lists)
      await db.memberships.bulkPut(memberships)
    })
  },

  async pendingJobs(): Promise<number> {
    return getDb().jobs.filter((j) => j.status === 'queued').count()
  },

  async runPipeline(geocoder: GeocoderId, onProgress: (p: PipelineProgress) => void): Promise<PipelineProgress | null> {
    controller?.abort()
    controller = new AbortController()
    try {
      return await runPipeline(getDb(), await servicesFor(geocoder), { onProgress, signal: controller.signal })
    } catch (err) {
      if (controller.signal.aborted) return null
      throw err
    }
  },

  cancelPipeline(): void {
    controller?.abort()
  },
}

export type DataWorkerApi = typeof api
Comlink.expose(api)
