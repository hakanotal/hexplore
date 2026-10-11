// Fails the build when the JavaScript needed for first paint grows past the
// budget. Follows static imports from the entry chunk in Vite's manifest, so
// lazy routes and workers are excluded.
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

interface Chunk {
  file: string
  isEntry?: boolean
  imports?: string[]
  css?: string[]
}

const dist = 'dist'
const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8')) as Record<string, Chunk>
const budget = JSON.parse(readFileSync('budget.json', 'utf8')) as { initialJsGzipKB: number; targetJsGzipKB: number }

const seen = new Set<string>()
const visit = (key: string) => {
  if (seen.has(key)) return
  seen.add(key)
  for (const dep of manifest[key]?.imports ?? []) visit(dep)
}
for (const [key, chunk] of Object.entries(manifest)) if (chunk.isEntry) visit(key)

let total = 0
const rows: [string, number][] = []
for (const key of seen) {
  const file = manifest[key]!.file
  if (!file.endsWith('.js')) continue
  const kb = gzipSync(readFileSync(join(dist, file)), { level: 9 }).length / 1024
  total += kb
  rows.push([file, kb])
}
rows.sort((a, b) => b[1] - a[1])
for (const [file, kb] of rows) console.log(`${kb.toFixed(1).padStart(8)} KB  ${file}`)
console.log(`${total.toFixed(1).padStart(8)} KB  initial JS (gzip). Gate ${budget.initialJsGzipKB} KB, target ${budget.targetJsGzipKB} KB.`)

if (total > budget.initialJsGzipKB) {
  console.error(`Initial JS is over budget by ${(total - budget.initialJsGzipKB).toFixed(1)} KB.`)
  process.exit(1)
}
