// Deterministic synthetic world used in place of a real Takeout export: the
// sample zip, demo data, the offline fixture geocoder and the perf dataset all
// derive from it, so they agree with each other.

import { latLngToS2Cell } from '../import/s2'

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Rng {
  next(): number
  int(min: number, max: number): number
  pick<T>(items: readonly T[]): T
  chance(p: number): boolean
  hex(len: number): string
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed)
  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    pick: (items) => items[Math.floor(next() * items.length)]!,
    chance: (p) => next() < p,
    hex: (len) => {
      let s = ''
      for (let i = 0; i < len; i++) s += Math.floor(next() * 16).toString(16)
      return s
    },
  }
}

interface Neighborhood {
  name: string
  lat: number
  lng: number
}

export interface City {
  name: string
  region: string
  country: string
  countryCode: string
  weight: number
  neighborhoods: Neighborhood[]
  streets: string[]
}

export const CITIES: City[] = [
  {
    name: 'Istanbul',
    region: 'Istanbul',
    country: 'Türkiye',
    countryCode: 'TR',
    weight: 5,
    neighborhoods: [
      { name: 'Kadıköy', lat: 40.9903, lng: 29.0293 },
      { name: 'Moda', lat: 40.9812, lng: 29.0257 },
      { name: 'Beşiktaş', lat: 41.0422, lng: 29.0067 },
      { name: 'Beyoğlu', lat: 41.0335, lng: 28.9779 },
      { name: 'Karaköy', lat: 41.0242, lng: 28.9776 },
      { name: 'Fatih', lat: 41.0086, lng: 28.9681 },
      { name: 'Üsküdar', lat: 41.0256, lng: 29.0154 },
      { name: 'Nişantaşı', lat: 41.0505, lng: 28.9937 },
      { name: 'Balat', lat: 41.0294, lng: 28.9488 },
    ],
    streets: ['Moda Caddesi', 'İstiklal Caddesi', 'Bahariye Caddesi', 'Serdar-ı Ekrem Sokak', 'Kumbaracı Yokuşu', 'Ihlamurdere Caddesi'],
  },
  {
    name: 'Lisbon',
    region: 'Lisboa',
    country: 'Portugal',
    countryCode: 'PT',
    weight: 2,
    neighborhoods: [
      { name: 'Alfama', lat: 38.7118, lng: -9.1300 },
      { name: 'Baixa', lat: 38.7107, lng: -9.1365 },
      { name: 'Bairro Alto', lat: 38.7134, lng: -9.1446 },
      { name: 'Príncipe Real', lat: 38.7172, lng: -9.1491 },
      { name: 'Belém', lat: 38.6979, lng: -9.2065 },
      { name: 'Alcântara', lat: 38.7038, lng: -9.1781 },
    ],
    streets: ['Rua Augusta', 'Rua da Rosa', 'Rua de São Bento', 'Calçada do Combro', 'Rua Garrett'],
  },
  {
    name: 'Tokyo',
    region: 'Tokyo',
    country: 'Japan',
    countryCode: 'JP',
    weight: 2,
    neighborhoods: [
      { name: 'Shibuya', lat: 35.6595, lng: 139.7005 },
      { name: 'Shinjuku', lat: 35.6938, lng: 139.7034 },
      { name: 'Asakusa', lat: 35.7148, lng: 139.7967 },
      { name: 'Shimokitazawa', lat: 35.6614, lng: 139.6680 },
      { name: 'Nakameguro', lat: 35.6440, lng: 139.6993 },
      { name: 'Ginza', lat: 35.6717, lng: 139.7650 },
    ],
    streets: ['Meiji-dori', 'Omotesando', 'Kappabashi-dori', 'Yasukuni-dori'],
  },
  {
    name: 'Berlin',
    region: 'Berlin',
    country: 'Germany',
    countryCode: 'DE',
    weight: 2,
    neighborhoods: [
      { name: 'Kreuzberg', lat: 52.4986, lng: 13.4030 },
      { name: 'Neukölln', lat: 52.4811, lng: 13.4353 },
      { name: 'Mitte', lat: 52.5200, lng: 13.4050 },
      { name: 'Prenzlauer Berg', lat: 52.5388, lng: 13.4244 },
      { name: 'Friedrichshain', lat: 52.5150, lng: 13.4540 },
    ],
    streets: ['Oranienstraße', 'Torstraße', 'Kastanienallee', 'Weserstraße', 'Simon-Dach-Straße'],
  },
  {
    name: 'New York',
    region: 'New York',
    country: 'United States',
    countryCode: 'US',
    weight: 2,
    neighborhoods: [
      { name: 'Williamsburg', lat: 40.7081, lng: -73.9571 },
      { name: 'East Village', lat: 40.7265, lng: -73.9815 },
      { name: 'West Village', lat: 40.7358, lng: -74.0036 },
      { name: 'Lower East Side', lat: 40.7150, lng: -73.9843 },
      { name: 'Midtown', lat: 40.7549, lng: -73.9840 },
      { name: 'Astoria', lat: 40.7644, lng: -73.9235 },
    ],
    streets: ['Bedford Avenue', 'Bleecker Street', 'Orchard Street', 'Steinway Street', 'St Marks Place'],
  },
  {
    name: 'Paris',
    region: 'Île-de-France',
    country: 'France',
    countryCode: 'FR',
    weight: 1,
    neighborhoods: [
      { name: 'Le Marais', lat: 48.8590, lng: 2.3620 },
      { name: 'Montmartre', lat: 48.8867, lng: 2.3431 },
      { name: 'Saint-Germain-des-Prés', lat: 48.8539, lng: 2.3338 },
      { name: 'Canal Saint-Martin', lat: 48.8710, lng: 2.3650 },
    ],
    streets: ['Rue de Bretagne', 'Rue des Martyrs', 'Rue du Bac', 'Quai de Valmy'],
  },
]

interface CategorySpec {
  category: string
  subcategory: string
  osm: [string, string]
  weight: number
  names: [readonly string[], readonly string[]]
  tags: readonly string[]
  price: [number, number] | null
}

const ADJ = ['Little', 'Blue', 'Old', 'Golden', 'Hidden', 'Corner', 'Green', 'Red', 'Wild', 'Quiet', 'Lucky', 'North', 'Silver', 'Tiny']
const NOUN = ['Fox', 'Lantern', 'Harbor', 'Garden', 'Owl', 'Anchor', 'Fig', 'Olive', 'Bridge', 'Tram', 'Moon', 'Pine', 'Kettle', 'Sparrow']

const CATEGORY_SPECS: CategorySpec[] = [
  { category: 'food', subcategory: 'restaurant', osm: ['amenity', 'restaurant'], weight: 9, names: [ADJ, ['Kitchen', 'Bistro', 'Table', 'Eatery', 'Meyhane', 'Lokanta', 'Tavern']], tags: ['seafood', 'meze', 'date night', 'vegan', 'tasting menu', 'terrace'], price: [2, 4] },
  { category: 'food', subcategory: 'street_food', osm: ['amenity', 'fast_food'], weight: 4, names: [NOUN, ['Döner', 'Ramen Stand', 'Taco Bar', 'Dumplings', 'Kokoreç', 'Bifana']], tags: ['late night', 'cheap eats', 'quick'], price: [1, 1] },
  { category: 'food', subcategory: 'bakery', osm: ['shop', 'bakery'], weight: 3, names: [ADJ, ['Bakery', 'Fırın', 'Pastelaria', 'Boulangerie', 'Bäckerei']], tags: ['pastry', 'breakfast', 'sourdough'], price: [1, 2] },
  { category: 'cafe', subcategory: 'coffee', osm: ['amenity', 'cafe'], weight: 8, names: [NOUN, ['Coffee', 'Roasters', 'Espresso Bar', 'Kahve', 'Café']], tags: ['good for work', 'specialty coffee', 'wifi', 'quiet', 'pastries'], price: [1, 2] },
  { category: 'bar', subcategory: 'cocktail_bar', osm: ['amenity', 'bar'], weight: 5, names: [ADJ, ['Bar', 'Lounge', 'Social', 'Rooftop']], tags: ['rooftop', 'cocktails', 'view', 'live dj'], price: [2, 3] },
  { category: 'bar', subcategory: 'pub', osm: ['amenity', 'pub'], weight: 3, names: [NOUN, ['Pub', 'Tap Room', 'Biergarten', 'Brewhouse']], tags: ['craft beer', 'sports', 'outdoor seating'], price: [1, 2] },
  { category: 'nightlife', subcategory: 'club', osm: ['amenity', 'nightclub'], weight: 1, names: [NOUN, ['Club', 'Hall', 'Basement']], tags: ['techno', 'late night'], price: [2, 3] },
  { category: 'culture', subcategory: 'museum', osm: ['tourism', 'museum'], weight: 4, names: [['Museum of', 'House of', 'Gallery of'], ['Modern Art', 'Innocence', 'Design', 'Photography', 'the City', 'Tiles', 'Toys']], tags: ['rainy day', 'architecture', 'history'], price: null },
  { category: 'culture', subcategory: 'gallery', osm: ['tourism', 'gallery'], weight: 2, names: [ADJ, ['Gallery', 'Art Space', 'Studio']], tags: ['contemporary', 'free entry'], price: null },
  { category: 'landmark', subcategory: 'viewpoint', osm: ['tourism', 'viewpoint'], weight: 2, names: [['Miradouro', 'Lookout', 'Terrace', 'Hill'], ADJ], tags: ['sunset', 'view', 'photo spot'], price: null },
  { category: 'landmark', subcategory: 'historic', osm: ['historic', 'monument'], weight: 2, names: [['Old', 'Grand', 'Ancient'], ['Tower', 'Gate', 'Cistern', 'Castle', 'Bazaar']], tags: ['history', 'architecture'], price: null },
  { category: 'nature', subcategory: 'park', osm: ['leisure', 'park'], weight: 3, names: [NOUN, ['Park', 'Gardens', 'Grove', 'Korusu']], tags: ['picnic', 'running', 'kid friendly', 'dog friendly'], price: null },
  { category: 'shopping', subcategory: 'books', osm: ['shop', 'books'], weight: 2, names: [NOUN, ['Books', 'Kitap', 'Livraria', 'Buchhandlung']], tags: ['secondhand', 'english books'], price: [1, 2] },
  { category: 'shopping', subcategory: 'clothes', osm: ['shop', 'clothes'], weight: 2, names: [ADJ, ['Vintage', 'Store', 'Atelier']], tags: ['vintage', 'local designers'], price: [2, 3] },
  { category: 'stay', subcategory: 'hotel', osm: ['tourism', 'hotel'], weight: 1, names: [ADJ, ['Hotel', 'Suites', 'Inn']], tags: ['boutique', 'pool'], price: [3, 4] },
  { category: 'sport', subcategory: 'climbing', osm: ['leisure', 'sports_centre'], weight: 1, names: [NOUN, ['Climbing', 'Boulder Gym']], tags: ['bouldering'], price: [2, 2] },
]

/** Chains that exist in several cities, to exercise ambiguity and list-context biasing. */
const CHAINS: { name: string; spec: number; cities: string[] }[] = [
  { name: 'Starbucks', spec: 3, cities: ['Istanbul', 'Lisbon', 'Tokyo', 'Berlin', 'New York', 'Paris'] },
  { name: 'Simit Sarayı', spec: 2, cities: ['Istanbul', 'Berlin', 'New York'] },
  { name: 'Five Guys', spec: 1, cities: ['Lisbon', 'Berlin', 'Paris', 'New York'] },
  { name: 'Blue Bottle Coffee', spec: 3, cities: ['Tokyo', 'New York'] },
]

export interface WorldPlace {
  index: number
  fid: string
  cid: string
  title: string
  lat: number
  lng: number
  category: string
  subcategory: string
  osmId: string
  osmTags: Record<string, string>
  street: string
  houseNumber: string
  address: string
  city: string
  neighborhood: string
  region: string
  country: string
  countryCode: string
  tags: string[]
  priceLevel: number | null
  chain: boolean
}

function weightedPick<T extends { weight: number }>(rng: Rng, items: readonly T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0)
  let r = rng.next() * total
  for (const item of items) {
    r -= item.weight
    if (r <= 0) return item
  }
  return items[items.length - 1]!
}

/**
 * Real feature IDs start with an S2 cell near where Google first placed the
 * feature. Measured on the owner's export: about half sit within 200 m of the
 * place, a third are 0.5 to 20 km off. The random draw that used to fill the
 * first half now supplies that offset, so the rest of the world stays the
 * same for a given seed.
 */
function makeFid(rng: Rng, lat: number, lng: number): { fid: string; cid: string } {
  const jitter = rng.hex(16)
  const unit = (from: number, to: number) => parseInt(jitter.slice(from, to), 16) / 16 ** (to - from)
  let dLat: number
  let dLng: number
  if (unit(8, 10) < 0.35) {
    // Far: 0.5 to 8 km in any direction.
    const km = 0.5 + 7.5 * unit(10, 13)
    const angle = 2 * Math.PI * unit(13, 16)
    dLat = (km / 111.32) * Math.cos(angle)
    dLng = (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(angle)
  } else {
    // Near: within about 150 m.
    dLat = (unit(0, 4) - 0.5) * 0.0027
    dLng = (unit(4, 8) - 0.5) * 0.0027
  }
  const a = `0x${latLngToS2Cell(lat + dLat, lng + dLng).toString(16).padStart(16, '0')}`
  // Keep the high bit clear so the CID stays a plausible positive 63-bit number.
  const b = `0x${(rng.int(1, 7)).toString(16)}${rng.hex(15)}`
  return { fid: `${a}:${b}`, cid: BigInt(b).toString(10) }
}

function buildPlace(rng: Rng, index: number, city: City, spec: CategorySpec, title: string, chain: boolean): WorldPlace {
  const hood = rng.pick(city.neighborhoods)
  // ~600 m spread around the neighborhood center
  const lat = +(hood.lat + (rng.next() - 0.5) * 0.012).toFixed(6)
  const lng = +(hood.lng + (rng.next() - 0.5) * 0.016).toFixed(6)
  const street = rng.pick(city.streets)
  const houseNumber = String(rng.int(1, 180))
  const { fid, cid } = makeFid(rng, lat, lng)
  const tags = [...new Set([rng.pick(spec.tags), rng.pick(spec.tags)])].slice(0, rng.int(1, 2))
  const priceLevel = spec.price ? rng.int(spec.price[0], spec.price[1]) : null
  const osmTags: Record<string, string> = { [spec.osm[0]]: spec.osm[1], name: title }
  if (rng.chance(0.4)) osmTags.opening_hours = rng.pick(['Mo-Su 08:00-22:00', 'Tu-Su 10:00-18:00', 'Mo-Fr 07:30-19:00; Sa,Su 09:00-17:00', 'Mo-Sa 18:00-02:00'])
  if (rng.chance(0.3)) osmTags.website = `https://example.com/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return {
    index,
    fid,
    cid,
    title,
    lat,
    lng,
    category: spec.category,
    subcategory: spec.subcategory,
    osmId: `node/${100000000 + index * 7919}`,
    osmTags,
    street,
    houseNumber,
    address: `${street} ${houseNumber}, ${hood.name}, ${city.name}, ${city.country}`,
    city: city.name,
    neighborhood: hood.name,
    region: city.region,
    country: city.country,
    countryCode: city.countryCode,
    tags,
    priceLevel,
    chain,
  }
}

export function generateWorld(count: number, seed = 42): WorldPlace[] {
  const rng = createRng(seed)
  const places: WorldPlace[] = []
  const usedTitles = new Set<string>()

  for (const chain of CHAINS) {
    for (const cityName of chain.cities) {
      if (places.length >= count) break
      const city = CITIES.find((c) => c.name === cityName)!
      places.push(buildPlace(rng, places.length, city, CATEGORY_SPECS[chain.spec]!, chain.name, true))
    }
  }

  let guard = 0
  while (places.length < count && guard++ < count * 20) {
    const city = weightedPick(rng, CITIES)
    const spec = weightedPick(rng, CATEGORY_SPECS)
    // Names are unique worldwide apart from chains; cross-city ambiguity comes
    // from chains and the fixture geocoder's decoys, at a realistic rate.
    let title = `${rng.pick(spec.names[0])} ${rng.pick(spec.names[1])}`
    if (usedTitles.has(title)) title = `${title} ${rng.pick(city.neighborhoods).name}`
    if (usedTitles.has(title)) title = `${rng.pick(NOUN)} & ${title}`
    if (usedTitles.has(title)) continue
    usedTitles.add(title)
    places.push(buildPlace(rng, places.length, city, spec, title, false))
  }
  return places
}
