import type { ImportOutcome } from '../db/importRepo'
import { dataWorker, proxy } from '../workers/client'
import type { PipelineProgress } from '../pipeline/runner'
import { useApp } from './store'

// Orchestration between the UI, the data worker and the store.

let pipelineRunning: Promise<void> | null = null
let fitAfterLoad = false

/** Runs queued enrichment jobs, refreshing the map as places get located. */
export function startPipeline(): Promise<void> {
  pipelineRunning ??= (async () => {
    try {
      const worker = dataWorker()
      // The worker picks the geocoder itself: deciding here raced with an
      // import that was still recording its data source.
      if (!(await worker.pendingJobs())) return
      let lastReload = Date.now()
      let lastStage = ''
      let located = false
      await worker.runPipeline(
        proxy((p: PipelineProgress) => {
          useApp.getState().setPipeline(p)
          if (p.stage === 'resolve' && p.resolved + p.flagged > 0) located = true
          if (p.stage !== lastStage || Date.now() - lastReload > 4000) {
            lastStage = p.stage
            lastReload = Date.now()
            void useApp.getState().load()
          }
        }),
      )
      if (located) fitAfterLoad = true
    } catch (err) {
      console.error('Pipeline failed', err)
    } finally {
      useApp.getState().setPipeline(null)
      await useApp.getState().load()
      // Newly located places usually change the extent; show them all.
      if (fitAfterLoad) useApp.getState().requestFit()
      fitAfterLoad = false
      pipelineRunning = null
    }
  })()
  return pipelineRunning
}

export function cancelPipeline(): void {
  void dataWorker().cancelPipeline()
}

export async function importFiles(files: File[]): Promise<ImportOutcome> {
  const payload = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })))
  const outcome = await dataWorker().importFiles(payload)
  await useApp.getState().load()
  return outcome
}

export async function importSample(count: number, revision: 1 | 2): Promise<ImportOutcome> {
  const outcome = await dataWorker().importSample(count, revision)
  await useApp.getState().load()
  return outcome
}

export async function seedDemo(count: number): Promise<void> {
  await dataWorker().seedDemo(count)
  await useApp.getState().load()
  useApp.getState().requestFit()
}

export async function refresh(): Promise<void> {
  await useApp.getState().load()
}
