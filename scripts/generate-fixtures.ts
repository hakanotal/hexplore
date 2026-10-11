// Writes sample Takeout archives to fixtures/ for manual testing: drop them on
// the import screen exactly like a real export.
//
//   npm run fixtures                 400 places
//   npm run fixtures -- --count 2000
import { mkdirSync, writeFileSync } from 'node:fs'
import { buildSampleTakeoutZip } from '../src/dev/sampleTakeout'

const arg = process.argv.indexOf('--count')
const count = arg > 0 ? Number(process.argv[arg + 1]) : 400

mkdirSync('fixtures', { recursive: true })
writeFileSync('fixtures/takeout-sample.zip', buildSampleTakeoutZip({ count, revision: 1 }))
writeFileSync('fixtures/takeout-sample-later.zip', buildSampleTakeoutZip({ count, revision: 2 }))
console.log(`Wrote fixtures/takeout-sample.zip and fixtures/takeout-sample-later.zip (${count} places)`)
