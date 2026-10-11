import * as Comlink from 'comlink'
import type { DataWorkerApi } from './data.worker'
import type { SearchWorkerApi } from './search.worker'

let data: Comlink.Remote<DataWorkerApi> | undefined
let searchApi: Comlink.Remote<SearchWorkerApi> | undefined

export function dataWorker(): Comlink.Remote<DataWorkerApi> {
  data ??= Comlink.wrap<DataWorkerApi>(new Worker(new URL('./data.worker.ts', import.meta.url), { type: 'module' }))
  return data
}

export function searchWorker(): Comlink.Remote<SearchWorkerApi> {
  searchApi ??= Comlink.wrap<SearchWorkerApi>(new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' }))
  return searchApi
}

export const proxy = Comlink.proxy
