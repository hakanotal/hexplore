// Runs a local Takeout export through the real parser and merge, prints what the
// app will make of it, and can write a zip with only the files the app uses,
// ready for the import screen. Nothing leaves the machine.
//
//   npm run inspect:takeout -- data/Takeout
//   npm run inspect:takeout -- data/Takeout --zip data/hexplore-import.zip
//   npm run inspect:takeout -- ~/Downloads/takeout-20261010.zip
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { zipSync } from 'fflate'
import { planImport, suggestRole } from '../src/import/merge'
import { expandFiles, readTakeout, type InputFile, type SourceList } from '../src/import/takeout'

const args = process.argv.slice(2)
const zipIdx = args.indexOf('--zip')
const zipOut = zipIdx >= 0 ? args[zipIdx + 1] : undefined
const input = args.find((a, i) => !a.startsWith('--') && i !== zipIdx + 1)
if (!input) {
  console.error('Usage: npm run inspect:takeout -- <Takeout folder or zip> [--zip out.zip]')
  process.exit(1)
}

function walk(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p) : [p]
    })
}

// Keep paths relative to the folder above "Takeout" so they match what the zip would hold.
const root = statSync(input).isDirectory() && basename(input) === 'Takeout' ? dirname(input) : input
const files: InputFile[] = statSync(input).isDirectory()
  ? walk(input)
      .filter((p) => !p.endsWith('.DS_Store') && (!zipOut || p !== zipOut))
      .map((p) => ({ path: relative(root, p), data: new Uint8Array(readFileSync(p)) }))
  : [{ path: basename(input), data: new Uint8Array(readFileSync(input)) }]

const parsed = await readTakeout(files)
const plan = planImport(parsed, { places: new Map(), lists: new Map(), memberships: [], lastFileHashes: {} })
const created = new Set(plan.putLists.map((l) => l.id))

const coverage = (l: SourceList) => {
  const by: Record<string, number> = {}
  for (const r of l.rows) by[r.coordSource ?? 'none'] = (by[r.coordSource ?? 'none'] ?? 0) + 1
  return Object.entries(by)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')
}

console.log('\nLists')
for (const l of parsed.lists) {
  const note = created.has(l.listId) ? `suggested role: ${suggestRole(l.name, l.source)}` : 'empty, not created'
  console.log(`  ${l.name.padEnd(22)} ${String(l.rows.length).padStart(4)} rows  ${note.padEnd(26)} coords: ${coverage(l) || '-'}`)
}

const places = plan.putPlaces
const by = (pred: (p: (typeof places)[number]) => boolean) => places.filter(pred).length
console.log('\nPlaces')
console.log(`  ${places.length} unique places in ${plan.putLists.length} lists (${plan.counts.newMemberships} memberships)`)
console.log(`  exact position from Google:     ${by((p) => p.resolveStatus === 'resolved')}`)
console.log(`  approximate (feature ID):       ${by((p) => p.coordSource === 'fid')}  refined by the resolve stage`)
console.log(`  no position yet:                ${by((p) => p.lat === undefined)}`)
const listCount = new Map<string, number>()
for (const m of plan.putMemberships) listCount.set(m.placeId, (listCount.get(m.placeId) ?? 0) + 1)
console.log(`  in more than one list:          ${[...listCount.values()].filter((c) => c > 1).length}`)

const titles = new Map<string, Set<string>>()
for (const m of plan.putMemberships) if (m.title) titles.set(m.placeId, (titles.get(m.placeId) ?? new Set()).add(m.title))
const differing = [...titles].filter(([, t]) => t.size > 1)
if (differing.length) {
  console.log(`\nSame place, different titles across lists (${differing.length}); the app keeps the first`)
  for (const [, t] of differing) console.log(`  ${[...t].join('  |  ')}`)
}

if (parsed.warnings.length) console.log(`\nWarnings\n${parsed.warnings.map((w) => `  ${w}`).join('\n')}`)
if (parsed.ignored.length) console.log(`\nIgnored files\n${parsed.ignored.map((w) => `  ${w}`).join('\n')}`)

if (zipOut) {
  const used = new Set(parsed.lists.filter((l) => created.has(l.listId)).map((l) => l.path))
  const entries = Object.fromEntries(expandFiles(files).filter((f) => used.has(f.path)).map((f) => [f.path, f.data]))
  writeFileSync(zipOut, zipSync(entries, { level: 6 }))
  console.log(`\nWrote ${zipOut} with ${Object.keys(entries).length} files. Drop it on the import screen.`)
}
