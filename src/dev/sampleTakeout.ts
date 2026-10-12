import { strToU8, zipSync } from 'fflate'
import { createRng, generateWorld, type WorldPlace, CITIES } from './world'

// Writes the synthetic world out in the layout Google Takeout uses, so the real
// import path runs end to end without real data. Matches the owner's export
// from October 2026:
//
//   Takeout/Saved/<List name>.csv                 one per list; no BOM, header,
//                                                 then an empty ",,,," row
//   Takeout/Saved/Images.csv, Default list(1).csv collections that are not Maps
//                                                 lists (empty, or saved films)
//   Takeout/Maps (your places)/Saved Places.json  starred places (GeoJSON)
//   Takeout/Maps (your places)/Reviews.json       GeoJSON too, ignored
//   Takeout/Maps/My labeled places/Labeled places.json  Home/Work, ignored
//
// List URLs carry only the feature ID, never coordinates; the ID's first half
// is an S2 cell near the place (see src/import/s2.ts).
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

export function placeUrl(p: WorldPlace, title = p.title): string {
  return `https://www.google.com/maps/place/${encodeURIComponent(title).replace(/%20/g, '+')}/data=!4m2!3m1!1s${p.fid}`
}

function dms(lat: number, lng: number): string {
  const part = (v: number, pos: string, neg: string) => {
    const a = Math.abs(v)
    const d = Math.floor(a)
    const m = Math.floor((a - d) * 60)
    const s = ((a - d) * 60 - m) * 60
    return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${v >= 0 ? pos : neg}`
  }
  return `${part(lat, 'N', 'S')} ${part(lng, 'E', 'W')}`
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
  // Description placement is still an assumption: none of the owner's lists has one.
  if (list.description) lines.push(csvField(list.description), '')
  lines.push('Title,Note,URL,Tags,Comment', ',,,,')
  for (const r of list.rows) lines.push([r.title, r.note, r.url, r.tags, r.comment].map(csvField).join(','))
  return lines.join('\n') + '\n'
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
  const istanbul: SampleRow[] = []
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
    // Lists saved while the app was in another language title the same place
    // differently ("Galata Kulesi" in one, "Galata Tower" in another).
    if (p.city === 'Istanbul' && isVisited && createRng(seed + p.index * 13).chance(0.3)) {
      const title = p.index % 2 === 0 ? `${p.title} ${p.neighborhood}` : p.title
      istanbul.push({ title, url: placeUrl(p, title) })
    }
    if (a.starred) starred.push(p)
  }

  // Dropped pins carry coordinates in the URL and no feature ID. Their title is
  // whatever the app called them: "Dropped pin", the Turkish "İşaretli Yer",
  // the coordinates in degrees, or nothing at all.
  const pinTitles = ['Dropped pin', 'İşaretli Yer', '', '']
  for (let i = 0; i < 4; i++) {
    const city = CITIES[i % 3]!
    const hood = city.neighborhoods[i]!
    const lat = hood.lat + 0.002 * (i + 1)
    const lng = hood.lng - 0.002 * (i + 1)
    const title = i === 2 ? dms(lat, lng) : pinTitles[i]!
    wantToGo.push({ title, note: i === 0 ? 'Parking spot near the ferry' : undefined, url: `https://www.google.com/maps/search/${lat.toFixed(7)},${lng.toFixed(7)}` })
  }
  // Rows without a URL exist in the wild; they fall back to a hashed key.
  wantToGo.push({ title: 'That ramen place Elif mentioned', note: 'Somewhere in Shibuya?' })

  const lists: SampleList[] = [
    { name: 'Want to go', rows: wantToGo },
    { name: 'Visited', rows: visited },
    { name: 'Favorite places', rows: favorites },
    { name: 'Coffee ☕', rows: coffee },
    { name: 'Lisbon trip', description: 'Lisbon, long weekend in May', rows: lisbon },
    { name: 'Istanbul', rows: istanbul },
    // Not Maps lists: an empty Google app collection and a saved film.
    { name: 'Images', rows: [] },
    { name: 'Default list(1)', rows: [{ title: 'The Man from Earth', url: 'https://www.google.com' }] },
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
  const reviewed = world.slice(0, 2)
  files['Takeout/Maps (your places)/Reviews.json'] = strToU8(
    JSON.stringify({
      type: 'FeatureCollection',
      features: reviewed.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        // Review URLs zero the first half of the feature ID.
        properties: {
          date: '2026-06-30T19:14:02.297475Z',
          five_star_rating_published: 5,
          google_maps_url: `https://www.google.com/maps/place//data=!4m2!3m1!1s0x0:${p.fid.split(':')[1]}`,
          location: { address: p.address, country_code: p.countryCode, name: p.title },
        },
      })),
    }),
  )
  files['Takeout/Maps/My labeled places/Labeled places.json'] = strToU8(
    JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [29.03, 40.99] }, properties: { name: 'Home' } }] }),
  )
  files['Takeout/archive_browser.html'] = strToU8('<html><body>Takeout archive browser</body></html>')
  return { files, world, lists }
}

export function buildSampleTakeoutZip(opts: SampleOptions = {}): Uint8Array {
  return zipSync(buildSampleTakeout(opts).files, { level: 6 })
}
