import Dexie, { type EntityTable, type Table } from 'dexie'
import type {
  CacheEntry,
  Embedding,
  ImportRecord,
  Job,
  List,
  Membership,
  Place,
  SavedView,
  Setting,
  UserData,
} from '../domain/types'

export const DB_NAME = 'hexplore'

export class HexploreDB extends Dexie {
  places!: EntityTable<Place, 'id'>
  lists!: EntityTable<List, 'id'>
  memberships!: Table<Membership, [string, string]>
  userData!: EntityTable<UserData, 'placeId'>
  embeddings!: EntityTable<Embedding, 'placeId'>
  imports!: EntityTable<ImportRecord, 'id'>
  jobs!: EntityTable<Job, 'id'>
  cache!: EntityTable<CacheEntry, 'key'>
  settings!: EntityTable<Setting, 'key'>
  savedViews!: EntityTable<SavedView, 'id'>

  constructor(name = DB_NAME) {
    super(name)
    // Schema changes go in a new version() block with an upgrade() when data
    // needs migrating. Never edit a released version in place.
    this.version(1).stores({
      places: 'id, googleCid, resolveStatus, category, countryCode, country, city, neighborhood, firstSeenAt',
      lists: 'id, name',
      memberships: '[placeId+listId], placeId, listId',
      userData: 'placeId',
      embeddings: 'placeId',
      imports: '++id, date',
      jobs: 'id, [stage+status], placeId, notBefore',
      cache: 'key',
      settings: 'key',
      savedViews: 'id',
    })
  }
}

let instance: HexploreDB | undefined

/** Shared connection. Workers get their own instance of the same database. */
export function getDb(): HexploreDB {
  instance ??= new HexploreDB()
  return instance
}

/** Tests swap in a fresh database per case. */
export function setDb(db: HexploreDB): void {
  instance = db
}
