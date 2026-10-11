import { strToU8, zipSync } from 'fflate'
import { createRng, generateWorld, type WorldPlace, CITIES } from './world'

// Writes the synthetic world out in the same layout Google Takeout uses, so the
// real import path can be exercised end to end before real data exists.
//
//   Takeout/Saved/<List name>.csv              one per list
//   Takeout/Maps (your places)/Saved Places.json starred places (GeoJSON)
//
// `revision` simulates a later export of the same account: a few more places,
// some want-to-go places moved to Visited, and a couple of edited notes.

export interface SampleOptions {
  count?: number
  seed?: number
  revision?: 1 | 2
}

interface SampleRow {
  title: string
  note?: string
  url?: string
  tags?: string
  comment?: string
}

interface SampleList {
  name: string
  description?: string
  bom?: boolean
  rows: SampleRow[]
}

const NOTES = [
  'Recommended by Elif',
  'Go early, gets busy after 7',
  'Try the "special" of the day',
  'Cash only, small place',
  'Great for a rainy afternoon 🌧️',
  'Ask for a table upstairs,\nthe view is better',
  'Closed Mondays',
  'Saw it on a reel 📸',
  'Book ahead on weekends',
  'Their lemon tart, trust me 🍋',
]

export function placeUrl(p: WorldPlace): string {
  return `https://www.google.com/maps/place/${encodeURIComponent(p.title).replace(/%20/g, '+')}/data=!4m2!3m1!1s${p.fid}`
}

export function cidUrl(p: WorldPlace): string {
  return `http://maps.google.com/?cid=${p.cid}`
}

function csvField(v: string | undefined): string {
  if (v === undefined) return ''
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function toCsv(list: SampleList): string {
  const lines: string[] = []
  if (list.description) lines.push(csvField(list.description), '')
  lines.push('Title,Note,URL,Tags,Comment')
  for (const r of list.rows) lines.push([r.title, r.note, r.url, r.tags, r.comment].map(csvField).join(','))
  return (list.bom ? '\uFEFF' : '') + lines.join('\n') + '\n'
}

interface Assignment {
  visited: boolean
  wantToGo: boolean
  favorite: boolean
  starred: boolean
  note?: string
  tags?: string
}

/** Per-place decisions use their own RNG so they stay stable when `count` changes. */
function assign(p: WorldPlace, seed: number): Assignment {
  const rng = createRng(seed * 7919 + p.index)
  const visited = rng.chance(0.4)
  const wantToGo = !visited && rng.chance(0.8)
  const favorite = visited && rng.chance(0.3)
  const starred = rng.chance(0.1)
  return {
    visited,
    wantToGo: wantToGo || (!visited && !starred),
    favorite,
    starred,
    note: rng.chance(0.25) ? rng.pick(NOTES) : undefined,
    tags: rng.chance(0.08) ? rng.pick(['❤️', 'date night', 'with kids', '⭐ must']) : undefined,
  }
}

export interface SampleTakeout {
  files: Record<string, Uint8Array>
  world: WorldPlace[]
  lists: SampleList[]
}

export function buildSampleTakeout(opts: SampleOptions = {}): SampleTakeout {
  const count = opts.count ?? 400
  const seed = opts.seed ?? 42
  const revision = opts.revision ?? 1
  const total = revision === 2 ? Math.round(count * 1.05) + 3 : count
  const world = generateWorld(total, seed)
  const rng = createRng(seed + revision)

  const visited: SampleRow[] = []
  const wantToGo: SampleRow[] = []
  const favorites: SampleRow[] = []
  const coffee: SampleRow[] = []
  const lisbon: SampleRow[] = []
  const starred: WorldPlace[] = []

  for (const p of world) {
    const a = assign(p, seed)
    let { visited: isVisited, wantToGo: isWant } = a
    let note = a.note
    // Revision 2: some want-to-go places got visited and moved lists, some notes changed.
    if (revision === 2 && isWant && createRng(seed + p.index * 31).chance(0.06)) {
      isWant = false
      isVisited = true
    }
    if (revision === 2 && note && createRng(seed + p.index * 17).chance(0.1)) note = `${note} (updated)`

    const row: SampleRow = { title: p.title, note, url: placeUrl(p), tags: a.tags }
    if (isVisited) visited.push(row)
    if (isWant) wantToGo.push(row)
    if (a.favorite && isVisited) favorites.push({ ...row, note: undefined })
    if (p.category === 'cafe' && createRng(seed + p.index).chance(0.5)) coffee.push({ title: p.title, url: placeUrl(p) })
    if (p.city === 'Lisbon' && isWant) lisbon.push({ title: p.title, url: placeUrl(p), note: note })
    if (a.starred) starred.push(p)
  }

  // Dropped pins carry coordinates in the URL and no feature ID.
  for (let i = 0; i < 3; i++) {
    const city = CITIES[i]!
    const hood = city.neighborhoods[i]!
    const lat = (hood.lat + 0.002 * (i + 1)).toFixed(6)
    const lng = (hood.lng - 0.002 * (i + 1)).toFixed(6)
    wantToGo.push({ title: 'Dropped pin', note: i === 0 ? 'Parking spot near the ferry' : undefined, url: `https://www.google.com/maps/search/${lat},${lng}` })
  }
  // Rows without a URL exist in the wild; they fall back to a hashed key.
  wantToGo.push({ title: 'That ramen place Elif mentioned', note: 'Somewhere in Shibuya?' })

  const lists: SampleList[] = [
    { name: 'Want to go', rows: wantToGo },
    { name: 'Visited', rows: visited, bom: true },
    { name: 'Favorite places', rows: favorites },
    { name: 'Coffee ☕', rows: coffee },
    { name: 'Lisbon trip', description: 'Lisbon, long weekend in May', rows: lisbon },
    { name: 'Travel plans', rows: [] },
  ]

  const starredJson = {
    type: 'FeatureCollection',
    features: starred.map((p, i) => {
      const unknownPosition = i % 25 === 7
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: unknownPosition ? [0, 0] : [p.lng, p.lat] },
        properties: {
          date: new Date(Date.UTC(2021, 0, 1) + Math.floor(rng.next() * 5 * 365) * 86400000).toISOString(),
          google_maps_url: cidUrl(p),
          location: { address: p.address, country_code: p.countryCode, name: p.title },
          Comment: 'No location information is available for this saved place',
        },
      }
    }),
  }
  // Only the unknown-position rows carry that comment in real exports.
  starredJson.features.forEach((f) => {
    const [lng, lat] = f.geometry.coordinates as [number, number]
    if (lng !== 0 || lat !== 0) delete (f.properties as { Comment?: string }).Comment
  })

  const files: Record<string, Uint8Array> = {}
  for (const list of lists) files[`Takeout/Saved/${list.name}.csv`] = strToU8(toCsv(list))
  files['Takeout/Maps (your places)/Saved Places.json'] = strToU8(JSON.stringify(starredJson, null, 2))
  files['Takeout/archive_browser.html'] = strToU8('<html><body>Takeout archive browser</body></html>')
  return { files, world, lists }
}

export function buildSampleTakeoutZip(opts: SampleOptions = {}): Uint8Array {
  return zipSync(buildSampleTakeout(opts).files, { level: 6 })
}
