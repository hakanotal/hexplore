import * as Comlink from 'comlink'
import type MiniSearch from 'minisearch'
import { createIndex, search, type SearchDoc } from '../query/search'

let index: MiniSearch<SearchDoc> | null = null

const api = {
  build(docs: SearchDoc[]): void {
    index = createIndex(docs)
  },
  search(query: string): Map<string, number> {
    return index ? search(index, query) : new Map()
  },
}

export type SearchWorkerApi = typeof api
Comlink.expose(api)
