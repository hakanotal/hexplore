// Fixed two-level taxonomy. Changing it bumps TAXONOMY_VERSION, which invalidates
// cached classification results so only the classify stage re-runs.

export const TAXONOMY_VERSION = 1

export interface Category {
  id: string
  label: string
  color: string
  subcategories: string[]
}

export const TAXONOMY: Category[] = [
  { id: 'food', label: 'Food', color: '#e4572e', subcategories: ['restaurant', 'fast_food', 'bakery', 'street_food', 'dessert', 'market'] },
  { id: 'cafe', label: 'Cafe', color: '#a0522d', subcategories: ['coffee', 'tea', 'brunch'] },
  { id: 'bar', label: 'Bar', color: '#8e44ad', subcategories: ['pub', 'wine_bar', 'cocktail_bar', 'brewery'] },
  { id: 'nightlife', label: 'Nightlife', color: '#5b2c83', subcategories: ['club', 'live_music', 'karaoke'] },
  { id: 'culture', label: 'Culture', color: '#2e86ab', subcategories: ['museum', 'gallery', 'theatre', 'cinema', 'library'] },
  { id: 'landmark', label: 'Landmark', color: '#c9a227', subcategories: ['monument', 'viewpoint', 'historic', 'religious'] },
  { id: 'nature', label: 'Nature', color: '#3a9d23', subcategories: ['park', 'beach', 'garden', 'trail', 'lake'] },
  { id: 'shopping', label: 'Shopping', color: '#d81b60', subcategories: ['clothes', 'books', 'mall', 'gifts', 'groceries'] },
  { id: 'stay', label: 'Stay', color: '#00897b', subcategories: ['hotel', 'hostel', 'apartment'] },
  { id: 'sport', label: 'Sport', color: '#1e88e5', subcategories: ['gym', 'pool', 'stadium', 'climbing'] },
  { id: 'services', label: 'Services', color: '#607d8b', subcategories: ['health', 'bank', 'coworking', 'repair'] },
  { id: 'transport', label: 'Transport', color: '#455a64', subcategories: ['station', 'airport', 'ferry', 'parking'] },
  { id: 'other', label: 'Other', color: '#9e9e9e', subcategories: [] },
]

export const CATEGORY_BY_ID: Record<string, Category> = Object.fromEntries(TAXONOMY.map((c) => [c.id, c]))

export function categoryColor(id: string | undefined): string {
  return CATEGORY_BY_ID[id ?? 'other']?.color ?? CATEGORY_BY_ID.other!.color
}

export function categoryLabel(id: string | undefined): string {
  return CATEGORY_BY_ID[id ?? 'other']?.label ?? 'Uncategorized'
}

/**
 * Rule-based mapping from OSM key=value to the taxonomy. Most OSM tags map
 * straight across; the LLM classifier handles whatever is left.
 */
const OSM_RULES: Record<string, Record<string, [string, string?]>> = {
  amenity: {
    restaurant: ['food', 'restaurant'],
    fast_food: ['food', 'fast_food'],
    food_court: ['food', 'street_food'],
    ice_cream: ['food', 'dessert'],
    cafe: ['cafe', 'coffee'],
    bar: ['bar', 'cocktail_bar'],
    pub: ['bar', 'pub'],
    biergarten: ['bar', 'brewery'],
    nightclub: ['nightlife', 'club'],
    theatre: ['culture', 'theatre'],
    cinema: ['culture', 'cinema'],
    library: ['culture', 'library'],
    arts_centre: ['culture', 'gallery'],
    place_of_worship: ['landmark', 'religious'],
    bank: ['services', 'bank'],
    hospital: ['services', 'health'],
    clinic: ['services', 'health'],
    pharmacy: ['services', 'health'],
    coworking_space: ['services', 'coworking'],
    ferry_terminal: ['transport', 'ferry'],
    parking: ['transport', 'parking'],
    marketplace: ['food', 'market'],
  },
  tourism: {
    museum: ['culture', 'museum'],
    gallery: ['culture', 'gallery'],
    viewpoint: ['landmark', 'viewpoint'],
    attraction: ['landmark'],
    artwork: ['culture', 'gallery'],
    hotel: ['stay', 'hotel'],
    hostel: ['stay', 'hostel'],
    guest_house: ['stay', 'apartment'],
    apartment: ['stay', 'apartment'],
  },
  historic: {
    monument: ['landmark', 'monument'],
    memorial: ['landmark', 'monument'],
    castle: ['landmark', 'historic'],
    ruins: ['landmark', 'historic'],
  },
  leisure: {
    park: ['nature', 'park'],
    garden: ['nature', 'garden'],
    beach_resort: ['nature', 'beach'],
    fitness_centre: ['sport', 'gym'],
    swimming_pool: ['sport', 'pool'],
    stadium: ['sport', 'stadium'],
    sports_centre: ['sport', 'gym'],
  },
  natural: {
    beach: ['nature', 'beach'],
    water: ['nature', 'lake'],
    peak: ['nature', 'trail'],
  },
  shop: {
    bakery: ['food', 'bakery'],
    pastry: ['food', 'dessert'],
    clothes: ['shopping', 'clothes'],
    books: ['shopping', 'books'],
    mall: ['shopping', 'mall'],
    gift: ['shopping', 'gifts'],
    supermarket: ['shopping', 'groceries'],
    coffee: ['cafe', 'coffee'],
    tea: ['cafe', 'tea'],
  },
  railway: { station: ['transport', 'station'] },
  aeroway: { aerodrome: ['transport', 'airport'] },
  building: { train_station: ['transport', 'station'] },
}

export function classifyByOsmTags(tags: Record<string, string> | undefined): { category: string; subcategory?: string } | null {
  if (!tags) return null
  for (const [key, values] of Object.entries(OSM_RULES)) {
    const value = tags[key]
    if (!value) continue
    const hit = values[value]
    if (hit) return { category: hit[0], subcategory: hit[1] }
  }
  return null
}

/** Google Places types to the taxonomy. Restaurant, store and bar subtypes fall back on their suffix. */
const GOOGLE_TYPE_RULES: Record<string, [string, string?]> = {
  restaurant: ['food', 'restaurant'],
  steak_house: ['food', 'restaurant'],
  diner: ['food', 'restaurant'],
  bar_and_grill: ['food', 'restaurant'],
  fast_food_restaurant: ['food', 'fast_food'],
  hamburger_restaurant: ['food', 'fast_food'],
  meal_takeaway: ['food', 'fast_food'],
  food_court: ['food', 'street_food'],
  bakery: ['food', 'bakery'],
  ice_cream_shop: ['food', 'dessert'],
  dessert_shop: ['food', 'dessert'],
  dessert_restaurant: ['food', 'dessert'],
  donut_shop: ['food', 'dessert'],
  chocolate_shop: ['food', 'dessert'],
  confectionery: ['food', 'dessert'],
  candy_store: ['food', 'dessert'],
  market: ['food', 'market'],
  farmers_market: ['food', 'market'],
  breakfast_restaurant: ['cafe', 'brunch'],
  brunch_restaurant: ['cafe', 'brunch'],
  cafe: ['cafe', 'coffee'],
  coffee_shop: ['cafe', 'coffee'],
  tea_house: ['cafe', 'tea'],
  bar: ['bar', 'cocktail_bar'],
  cocktail_bar: ['bar', 'cocktail_bar'],
  pub: ['bar', 'pub'],
  wine_bar: ['bar', 'wine_bar'],
  brewery: ['bar', 'brewery'],
  brewpub: ['bar', 'brewery'],
  night_club: ['nightlife', 'club'],
  karaoke: ['nightlife', 'karaoke'],
  live_music_venue: ['nightlife', 'live_music'],
  museum: ['culture', 'museum'],
  art_gallery: ['culture', 'gallery'],
  performing_arts_theater: ['culture', 'theatre'],
  opera_house: ['culture', 'theatre'],
  concert_hall: ['culture', 'theatre'],
  movie_theater: ['culture', 'cinema'],
  library: ['culture', 'library'],
  cultural_center: ['culture'],
  aquarium: ['culture'],
  historical_landmark: ['landmark', 'historic'],
  historical_place: ['landmark', 'historic'],
  castle: ['landmark', 'historic'],
  monument: ['landmark', 'monument'],
  sculpture: ['landmark', 'monument'],
  observation_deck: ['landmark', 'viewpoint'],
  ferris_wheel: ['landmark', 'viewpoint'],
  church: ['landmark', 'religious'],
  mosque: ['landmark', 'religious'],
  synagogue: ['landmark', 'religious'],
  hindu_temple: ['landmark', 'religious'],
  buddhist_temple: ['landmark', 'religious'],
  place_of_worship: ['landmark', 'religious'],
  tourist_attraction: ['landmark'],
  amusement_park: ['landmark'],
  zoo: ['nature'],
  park: ['nature', 'park'],
  beach: ['nature', 'beach'],
  garden: ['nature', 'garden'],
  botanical_garden: ['nature', 'garden'],
  hiking_area: ['nature', 'trail'],
  lake: ['nature', 'lake'],
  shopping_mall: ['shopping', 'mall'],
  clothing_store: ['shopping', 'clothes'],
  shoe_store: ['shopping', 'clothes'],
  book_store: ['shopping', 'books'],
  gift_shop: ['shopping', 'gifts'],
  supermarket: ['shopping', 'groceries'],
  grocery_store: ['shopping', 'groceries'],
  hotel: ['stay', 'hotel'],
  lodging: ['stay', 'hotel'],
  resort_hotel: ['stay', 'hotel'],
  hostel: ['stay', 'hostel'],
  bed_and_breakfast: ['stay', 'apartment'],
  guest_house: ['stay', 'apartment'],
  gym: ['sport', 'gym'],
  fitness_center: ['sport', 'gym'],
  sports_complex: ['sport', 'gym'],
  swimming_pool: ['sport', 'pool'],
  stadium: ['sport', 'stadium'],
  arena: ['sport', 'stadium'],
  hospital: ['services', 'health'],
  doctor: ['services', 'health'],
  pharmacy: ['services', 'health'],
  dentist: ['services', 'health'],
  bank: ['services', 'bank'],
  coworking_space: ['services', 'coworking'],
  train_station: ['transport', 'station'],
  subway_station: ['transport', 'station'],
  light_rail_station: ['transport', 'station'],
  bus_station: ['transport', 'station'],
  transit_station: ['transport', 'station'],
  airport: ['transport', 'airport'],
  international_airport: ['transport', 'airport'],
  ferry_terminal: ['transport', 'ferry'],
  parking: ['transport', 'parking'],
  store: ['shopping'],
}

const GOOGLE_SUFFIX_RULES: [string, [string, string?]][] = [
  ['_restaurant', ['food', 'restaurant']],
  ['_bar', ['bar', 'cocktail_bar']],
  ['_park', ['nature', 'park']],
  ['_store', ['shopping']],
  ['_shop', ['shopping']],
]

export function classifyByGoogleTypes(primaryType: string | undefined, types: string[] | undefined): { category: string; subcategory?: string } | null {
  const all = [primaryType, ...(types ?? [])].filter((t): t is string => !!t)
  for (const t of all) {
    const hit = GOOGLE_TYPE_RULES[t]
    if (hit) return { category: hit[0], subcategory: hit[1] }
  }
  for (const t of all) {
    const hit = GOOGLE_SUFFIX_RULES.find(([suffix]) => t.endsWith(suffix))?.[1]
    if (hit) return { category: hit[0], subcategory: hit[1] }
  }
  return null
}
