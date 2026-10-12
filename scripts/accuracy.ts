// Accuracy sets built from your own export (docs/plan.md, Testing).
//
//   npm run accuracy -- data/Takeout              build the set on first run, then measure
//   npm run accuracy -- data/Takeout --size 100   a bigger set (only on first run)
//   npm run accuracy -- --evaluate                score data/accuracy/classification.csv
//
// Resolution: a sample of your places gets Google's exact position once
// (Place Details, Pro tier, one call per place; the result is saved), then
// every run measures the OpenStreetMap fallback against it: the feature-ID
// point alone, a search near that point, and a search by name only.
//
// Classification: writes a CSV of the same places with the category the
// rules give them. Fix the "correct" column where it is wrong, then run with
// --evaluate. Everything stays under data/, which is never committed.
import 'fake-indexeddb/auto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { readTakeout, type InputFile } from '../src/import/takeout'
import { fidToLatLng } from '../src/import/s2'
import { GooglePlaces } from '../src/services/googlePlaces'
import { PhotonGeocoder } from '../src/services/photon'
import { resolvePlace } from '../src/pipeline/resolve'
import { haversineKm } from '../src/pipeline/similarity'
import { classifyByGoogleTypes } from '../src/domain/taxonomy'
import { UNTITLED_PLACE, type Place } from '../src/domain/types'

const OUT = 'data/accuracy'
const TRUTH = `${OUT}/resolution.json`
const CLASSES = `${OUT}/classification.csv`
/** An accepted point further than this from Google's counts as wrong. */
const WRONG_M = 250

interface Truth {
  fid: string
  title: string
  lat: number
  lng: number
  googleName?: string
  types: string[]
  primaryType?: string
}

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)

function walk(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))
}

function envKey(): string {
  const line = existsSync('.env') ? readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('PLACES_API_KEY=')) : undefined
  return line?.slice('PLACES_API_KEY='.length).trim().replace(/^["']|["']$/g, '') ?? ''
}

/** Deterministic shuffle, so the same export always yields the same set. */
function sample<T>(items: T[], n: number): T[] {
  let seed = 42
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a.slice(0, n)
}

async function buildTruth(input: string, size: number): Promise<Truth[]> {
  const root = basename(input) === 'Takeout' ? dirname(input) : input
  const files: InputFile[] = walk(input)
    .filter((p) => p.endsWith('.csv') || p.endsWith('.json'))
    .map((p) => ({ path: relative(root, p), data: new Uint8Array(readFileSync(p)) }))
  const parsed = await readTakeout(files)
  const rows = new Map<string, { fid: string; title: string }>()
  for (const l of parsed.lists) for (const r of l.rows) if (r.googleFid && r.title !== UNTITLED_PLACE) rows.set(r.googleFid, { fid: r.googleFid, title: r.title })
  const key = envKey()
  if (!key) throw new Error('Building the set needs PLACES_API_KEY in .env')
  let calls = 0
  const google = new GooglePlaces(key, { take: async () => ++calls <= size })
  const truth: Truth[] = []
  for (const row of sample([...rows.values()], size)) {
    const g = await google.details(row.fid)
    if (g) truth.push({ fid: row.fid, title: row.title, lat: g.lat, lng: g.lng, googleName: g.name, types: g.types, primaryType: g.primaryType })
  }
  console.log(`Built a set of ${truth.length} places with ${calls} Place Details calls.`)
  return truth
}

const pct = (n: number, of: number) => `${Math.round((n / Math.max(1, of)) * 100)}%`
const quantile = (xs: number[], q: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))]! : NaN)

async function measure(truth: Truth[]) {
  const photon = new PhotonGeocoder()
  const ctx = { lists: [], hints: [] }
  const fidErr: number[] = []
  const tallies = {
    anchored: { accepted: 0, wrong: 0, flagged: 0, keptGoogle: 0, review: 0 },
    nameOnly: { accepted: 0, wrong: 0, flagged: 0, keptGoogle: 0, review: 0 },
  }
  for (const t of truth) {
    const point = fidToLatLng(t.fid)
    if (point) fidErr.push(haversineKm(point, t) * 1000)
    const base: Place = { id: t.fid, title: t.title, googleFid: t.fid, resolveStatus: 'pending', aiTags: [], firstSeenAt: 0, updatedAt: 0 }
    const runs = [
      ['anchored', point ? { ...base, lat: point.lat, lng: point.lng, coordSource: 'fid' as const } : base],
      ['nameOnly', base],
    ] as const
    for (const [name, place] of runs) {
      const out = await resolvePlace(place, { geocoder: photon, ctx, final: true })
      if (out.kind !== 'commit') continue
      const p = out.patch
      const tally = tallies[name]
      if (p.resolveStatus === 'review') tally.review++
      else if (p.coordSource === 'fid') tally.keptGoogle++
      else if (p.resolveStatus === 'flagged') tally.flagged++
      else {
        tally.accepted++
        const off = p.lat !== undefined ? haversineKm({ lat: p.lat, lng: p.lng! }, t) * 1000 : 0
        if (off > WRONG_M) {
          tally.wrong++
          if (flag('--verbose')) console.log(`  wrong (${name}): "${t.title}" -> ${p.address ?? ''} [${p.osmTags ? Object.entries(p.osmTags).filter(([k]) => k !== 'name').map(([k, v]) => `${k}=${v}`).join(' ') : ''}] ${Math.round(off)} m off`)
        }
      }
    }
  }
  const n = truth.length
  console.log(`\nResolution on ${n} places (truth: Google Place Details)`)
  console.log(`  Feature-ID point alone   median ${Math.round(quantile(fidErr, 0.5))} m, 90th percentile ${Math.round(quantile(fidErr, 0.9))} m, over 500 m: ${fidErr.filter((e) => e > 500).length}`)
  for (const [label, t] of [
    ['Search near that point  ', tallies.anchored],
    ['Search by name only     ', tallies.nameOnly],
  ] as const) {
    console.log(
      `  ${label} accepted ${pct(t.accepted, n)} (wrong ${t.wrong}, ${pct(t.wrong, t.accepted)} of accepted), flagged ${pct(t.flagged, n)}, kept Google's point ${pct(t.keptGoogle, n)}, review ${pct(t.review, n)}`,
    )
  }
  console.log(`  Targets (plan): under 2% wrong among accepted, under 10% sent to review.`)
}

function writeClassificationTemplate(truth: Truth[]) {
  if (existsSync(CLASSES)) return
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = ['fid,title,google_type,predicted,correct']
  for (const t of truth) {
    const predicted = classifyByGoogleTypes(t.primaryType, t.types)?.category ?? 'uncategorized'
    lines.push([t.fid, t.title, t.primaryType ?? '', predicted, ''].map(esc).join(','))
  }
  writeFileSync(CLASSES, lines.join('\n') + '\n')
  console.log(`\nWrote ${CLASSES}: fill the "correct" column where the predicted category is wrong, then run with --evaluate.`)
}

function evaluateClassification() {
  if (!existsSync(CLASSES)) throw new Error(`No ${CLASSES} yet; run the resolution set first.`)
  const rows = readFileSync(CLASSES, 'utf8').trim().split('\n').slice(1)
  let right = 0
  let total = 0
  for (const line of rows) {
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')) ?? []
    const [predicted, correct] = [cells[3], cells[4]]
    if (!predicted) continue
    total++
    if (!correct || correct === predicted) right++
  }
  console.log(`Classification: ${right} of ${total} right (${pct(right, total)}). Target: 90% or better.`)
}

if (flag('--evaluate')) {
  evaluateClassification()
} else {
  const input = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--size')
  mkdirSync(OUT, { recursive: true })
  let truth: Truth[]
  if (existsSync(TRUTH)) {
    truth = JSON.parse(readFileSync(TRUTH, 'utf8')) as Truth[]
    console.log(`Using the saved set of ${truth.length} places (${TRUTH}).`)
  } else {
    if (!input) throw new Error('Usage: npm run accuracy -- <Takeout folder> [--size 50]')
    truth = await buildTruth(input, Number(value('--size') ?? 50))
    writeFileSync(TRUTH, JSON.stringify(truth, null, 1))
  }
  await measure(truth)
  writeClassificationTemplate(truth)
}
