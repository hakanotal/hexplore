import { HexploreDB, setDb } from '../db/db'

let n = 0

/** Fresh, isolated database for one test. */
export function freshDb(): HexploreDB {
  const db = new HexploreDB(`hexplore-test-${process.pid}-${n++}`)
  setDb(db)
  return db
}
