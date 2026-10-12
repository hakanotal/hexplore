import * as Comlink from 'comlink'
import { getDb } from '../db/db'
import { importTakeout, type ImportOutcome } from '../db/importRepo'
import { buildSampleTakeout } from '../dev/sampleTakeout'
import { buildDemoData } from '../dev/demoData'
import { FixtureGeocoder } from '../dev/fixtureGeocoder'
import { FixtureOverpass } from '../dev/fixtureOverpass'
import { OverpassClient } from '../services/overpass'
import { OpenRouterClient } from '../services/openrouter'
import { aiClassifier, aiDisambiguator } from '../pipeline/ai'
import { generateWorld } from '../dev/world'
import { healQueue, runPipeline, type PipelineProgress, type PipelineServices } from '../pipeline/runner'
import { computeStats, type Stats } from '../stats/compute'
import type { GeocoderId } from '../services/geocoder'
import { NominatimGeocoder } from '../services/nominatim'
import { PhotonGeocoder } from '../services/photon'
import { GooglePlaces } from '../services/googlePlaces'
import { activeGeocoder, googlePlacesKey, loadSettings, setDataSource, takeGoogleCall } from '../db/settings'

// Heavy jobs off the main thread: Takeout parsing and merging, the enrichment
// pipeline, and demo data generation. Opens its own connection to the database.

let controller: AbortController | null = null

async function fixtureServices(): Promise<PipelineServices> {
  const size = ((await getDb().settings.get('sampleWorldSize'))?.value as number | undefined) ?? 500
  const world = generateWorld(size)
  const fixture = new FixtureGeocoder(world)
  return { geocoder: fixture, reverse: fixture, pois: new FixtureOverpass(world) }
}

async function servicesFor(id: GeocoderId): Promise<PipelineServices> {
  if (id === 'fixture') return fixtureServices()
  const nominatim = new NominatimGeocoder()
  const settings = await loadSettings()
  const key = googlePlacesKey(settings)
  // AI steps need both a key and a model chosen in Settings.
  const ai = settings.openRouterKey && settings.classifyModel ? { client: new OpenRouterClient(settings.openRouterKey), opts: { model: settings.classifyModel, excludeNotes: settings.excludeNotesFromAI } } : null
  return {
    geocoder: id === 'nominatim' ? nominatim : new PhotonGeocoder(),
    reverse: nominatim,
    places: key ? new GooglePlaces(key, { take: () => takeGoogleCall() }) : undefined,
    pois: new OverpassClient(),
    disambiguate: ai ? aiDisambiguator(ai.client, ai.opts) : undefined,
    classifier: ai ? aiClassifier(ai.client, ai.opts) : undefined,
  }
}

const api = {
  // Each import records its data source before writing any job, so a pipeline
  // run that sees the jobs also sees which geocoder they belong to.
  async importFiles(files: { name: string; data: Uint8Array }[]): Promise<ImportOutcome> {
    await setDataSource('takeout')
    return importTakeout(files.map((f) => ({ path: f.name, data: f.data })))
  },

  /** Imports a synthetic Takeout through the real import path. */
  async importSample(count: number, revision: 1 | 2): Promise<ImportOutcome> {
    const sample = buildSampleTakeout({ count, revision })
    await getDb().settings.put({ key: 'sampleWorldSize', value: sample.world.length + 50 })
    await setDataSource('sample')
    return importTakeout(Object.entries(sample.files).map(([path, data]) => ({ path, data })))
  },

  async seedDemo(count: number): Promise<void> {
    const db = getDb()
    await setDataSource('demo')
    const { places, lists, memberships } = buildDemoData(count)
    await db.transaction('rw', [db.places, db.lists, db.memberships], async () => {
      await db.places.bulkPut(places)
      await db.lists.bulkPut(lists)
      await db.memberships.bulkPut(memberships)
    })
  },

  /** Heals the queue first, so work that a new key or a new stage makes possible counts as pending. */
  async pendingJobs(): Promise<number> {
    const services = await servicesFor(await activeGeocoder())
    await healQueue(getDb(), Date.now(), { match: !!services.pois, ai: !!services.classifier })
    return getDb().jobs.filter((j) => j.status === 'queued').count()
  },

  /** Picks the geocoder from the data source when the run starts, not when it was requested. */
  async runPipeline(onProgress: (p: PipelineProgress) => void): Promise<PipelineProgress | null> {
    controller?.abort()
    controller = new AbortController()
    try {
      return await runPipeline(getDb(), await servicesFor(await activeGeocoder()), { onProgress, signal: controller.signal })
    } catch (err) {
      if (controller.signal.aborted) return null
      throw err
    }
  },

  cancelPipeline(): void {
    controller?.abort()
  },

  /** Straight from IndexedDB, off the main thread; fast enough to recompute on every visit. */
  async stats(): Promise<Stats> {
    const db = getDb()
    const [places, memberships, lists, userData, imports] = await Promise.all([
      db.places.toArray(),
      db.memberships.toArray(),
      db.lists.toArray(),
      db.userData.toArray(),
      db.imports.toArray(),
    ])
    return computeStats({ places, memberships, lists, userData, imports })
  },
}

export type DataWorkerApi = typeof api
Comlink.expose(api)
