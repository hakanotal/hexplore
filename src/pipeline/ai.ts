import { getDb } from '../db/db'
import { CATEGORY_BY_ID, TAXONOMY, TAXONOMY_VERSION } from '../domain/taxonomy'
import { hashString } from '../import/googleUrl'
import type { GeoCandidate } from '../services/geocoder'
import { cached } from '../services/http'
import type { JsonModel } from '../services/openrouter'
import type { Disambiguator, DisambiguationInput } from './resolve'

// The two model calls in the pipeline: picking between same-named geocoder
// candidates, and classifying places in batches. Both are cached per input,
// so a re-run or a re-import never pays twice, and both drop notes when the
// owner asked to keep them out of AI calls.

export interface AiOptions {
  model: string
  excludeNotes: boolean
}

// ---- Disambiguation --------------------------------------------------------

function describeCandidate(c: GeoCandidate, i: number): string {
  const kind = Object.entries(c.osmTags)
    .filter(([k]) => k !== 'name')
    .map(([k, v]) => `${k}=${v}`)
    .slice(0, 4)
    .join(', ')
  return `${i}. ${c.name} | ${c.address ?? [c.city, c.country].filter(Boolean).join(', ')}${kind ? ` | ${kind}` : ''}`
}

export function disambiguationPrompt(input: DisambiguationInput, excludeNotes: boolean): string {
  return [
    `Saved place: "${input.title}"`,
    input.listNames.length ? `Lists it is saved in: ${input.listNames.join(', ')}` : '',
    input.clusterCities.length ? `Other places in those lists are mostly in: ${[...new Set(input.clusterCities)].join(', ')}` : '',
    !excludeNotes && input.hints.length ? `Notes: ${input.hints.join(' / ')}` : '',
    'Candidates:',
    ...input.candidates.map(describeCandidate),
  ]
    .filter(Boolean)
    .join('\n')
}

const PICK_SCHEMA = {
  type: 'object',
  properties: {
    index: { type: 'integer', description: 'The matching candidate, or -1 if none matches' },
    confidence: { type: 'number', description: '0 to 1' },
  },
  required: ['index', 'confidence'],
  additionalProperties: false,
}

export function aiDisambiguator(model: JsonModel, opts: AiOptions): Disambiguator {
  return async (input, signal) => {
    const prompt = disambiguationPrompt(input, opts.excludeNotes)
    const out = await cached(`ai:pick:${opts.model}:${hashString(prompt)}`, () =>
      model.json<{ index: number; confidence: number }>({
        model: opts.model,
        name: 'pick_candidate',
        schema: PICK_SCHEMA,
        maxTokens: 60,
        signal,
        messages: [
          {
            role: 'system',
            content:
              'You match a place someone saved in Google Maps to one of several map search results. Use the lists, where the other saved places are, and any notes. Answer -1 when none fits.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    )
    const index = Number.isInteger(out.index) && out.index >= -1 && out.index < input.candidates.length ? out.index : -1
    const confidence = Math.max(0, Math.min(1, Number(out.confidence) || 0))
    return { index, confidence }
  }
}

// ---- Classification --------------------------------------------------------

export interface ClassifyInput {
  id: string
  title: string
  lists: string[]
  notes: string[]
  tags: string[]
  googleTypes?: string[]
  osmTags?: Record<string, string>
  address?: string
}

export interface ClassifyResult {
  category: string
  subcategory?: string
  aiTags: string[]
  priceLevel: number | null
  summary?: string
}

export interface Classifier {
  classify(items: ClassifyInput[], signal?: AbortSignal): Promise<Map<string, ClassifyResult>>
}

const OSM_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'historic', 'cuisine', 'diet:vegan', 'diet:vegetarian', 'outdoor_seating', 'wheelchair', 'internet_access']

function describePlace(p: ClassifyInput, excludeNotes: boolean) {
  const osm = Object.fromEntries(OSM_KEYS.filter((k) => p.osmTags?.[k]).map((k) => [k, p.osmTags![k]]))
  return {
    id: p.id,
    title: p.title,
    lists: p.lists,
    ...(p.tags.length ? { tags: p.tags } : {}),
    ...(!excludeNotes && p.notes.length ? { notes: p.notes.map((n) => n.slice(0, 200)) } : {}),
    ...(p.googleTypes?.length ? { googleTypes: p.googleTypes.slice(0, 5) } : {}),
    ...(Object.keys(osm).length ? { osm } : {}),
    ...(p.address ? { address: p.address } : {}),
  }
}

const TAXONOMY_TEXT = TAXONOMY.map((c) => `${c.id}: ${c.subcategories.join(', ') || '(no subcategories)'}`).join('\n')

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    places: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          category: { type: 'string', enum: TAXONOMY.map((c) => c.id) },
          subcategory: { type: ['string', 'null'] },
          aiTags: { type: 'array', items: { type: 'string' } },
          priceLevel: { type: ['integer', 'null'] },
          summary: { type: 'string' },
        },
        required: ['id', 'category', 'subcategory', 'aiTags', 'priceLevel', 'summary'],
        additionalProperties: false,
      },
    },
  },
  required: ['places'],
  additionalProperties: false,
}

const CLASSIFY_SYSTEM = `You classify places someone saved in Google Maps.
For each place return:
- category: one id from the taxonomy below
- subcategory: one of that category's subcategories, or null
- aiTags: up to 8 short lowercase tags a person would filter by (rooftop, vegan, good for work, kid friendly, live music, view, late night). Only tags the name, types, OSM tags or notes support.
- priceLevel: 1 to 4, or null when unknown
- summary: one plain sentence under 120 characters saying what the place is. No praise, no facts you cannot see in the input.
Taxonomy:
${TAXONOMY_TEXT}`

/** Keeps model output inside the taxonomy and the documented ranges. */
export function cleanResult(raw: Record<string, unknown>): ClassifyResult {
  const category = typeof raw.category === 'string' && CATEGORY_BY_ID[raw.category] ? raw.category : 'other'
  const sub = typeof raw.subcategory === 'string' && CATEGORY_BY_ID[category]!.subcategories.includes(raw.subcategory) ? raw.subcategory : undefined
  const tags = Array.isArray(raw.aiTags) ? raw.aiTags.filter((t): t is string => typeof t === 'string').map((t) => t.trim().toLowerCase()).filter((t) => t && t.length <= 30) : []
  const price = typeof raw.priceLevel === 'number' && Number.isInteger(raw.priceLevel) && raw.priceLevel >= 1 && raw.priceLevel <= 4 ? raw.priceLevel : null
  const summary = typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary.trim().slice(0, 160) : undefined
  return { category, subcategory: sub, aiTags: [...new Set(tags)].slice(0, 8), priceLevel: price, summary }
}

export function aiClassifier(model: JsonModel, opts: AiOptions): Classifier {
  const keyOf = (p: ClassifyInput) => `ai:classify:v${TAXONOMY_VERSION}:${opts.model}:${hashString(JSON.stringify(describePlace(p, opts.excludeNotes)))}`
  return {
    async classify(items, signal) {
      const out = new Map<string, ClassifyResult>()
      // Results are cached per place, so only places the model has not seen go out.
      const db = getDb()
      const misses: ClassifyInput[] = []
      for (const p of items) {
        const hit = await db.cache.get(keyOf(p))
        if (hit) out.set(p.id, hit.value as ClassifyResult)
        else misses.push(p)
      }
      if (!misses.length) return out
      const res = await model.json<{ places: Record<string, unknown>[] }>({
        model: opts.model,
        name: 'classify_places',
        schema: CLASSIFY_SCHEMA,
        maxTokens: 120 * misses.length + 200,
        signal,
        messages: [
          { role: 'system', content: CLASSIFY_SYSTEM },
          { role: 'user', content: JSON.stringify({ places: misses.map((p) => describePlace(p, opts.excludeNotes)) }) },
        ],
      })
      const byId = new Map((res.places ?? []).map((r) => [String(r.id), r]))
      for (const p of misses) {
        const raw = byId.get(p.id)
        if (!raw) continue
        const result = cleanResult(raw)
        out.set(p.id, result)
        await db.cache.put({ key: keyOf(p), value: result, createdAt: Date.now() })
      }
      return out
    },
  }
}
