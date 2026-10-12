import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { freshDb } from '../test/db'
import { OpenRouterClient, type JsonModel, type JsonRequest } from '../services/openrouter'
import { aiClassifier, aiDisambiguator, cleanResult, disambiguationPrompt, type ClassifyInput } from './ai'

// Recorded shape of an OpenRouter completion; CI never calls the live service.
let lastBody: Record<string, unknown> | null = null
const server = setupServer(
  http.post('https://openrouter.ai/api/v1/chat/completions', async ({ request }) => {
    lastBody = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({ choices: [{ message: { content: '```json\n{"index": 1, "confidence": 0.9}\n```' } }] })
  }),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
beforeEach(() => {
  freshDb()
  lastBody = null
})

/** Records requests and answers from a function, like a model would. */
function stubModel(answer: (req: JsonRequest) => unknown): JsonModel & { calls: JsonRequest[] } {
  const calls: JsonRequest[] = []
  return {
    calls,
    async json<T>(req: JsonRequest) {
      calls.push(req)
      return answer(req) as T
    },
  }
}

const cand = (name: string, city: string) => ({ name, lat: 1, lng: 1, city, country: 'X', osmTags: { amenity: 'cafe', name }, source: 't' })

describe('OpenRouterClient', () => {
  it('asks for strict JSON at temperature 0 and reads fenced answers', async () => {
    const out = await new OpenRouterClient('sk-test').json<{ index: number }>({ model: 'm', name: 'pick', schema: { type: 'object' }, messages: [{ role: 'user', content: 'hi' }] })
    expect(out.index).toBe(1)
    expect(lastBody).toMatchObject({ model: 'm', temperature: 0, response_format: { type: 'json_schema', json_schema: { name: 'pick', strict: true } } })
  })
})

describe('aiDisambiguator', () => {
  const input = { title: 'Starbucks', hints: ['the one near the ferry'], listNames: ['Istanbul'], clusterCities: ['Istanbul'], candidates: [cand('Starbucks', 'Berlin'), cand('Starbucks', 'Istanbul')] }

  it('sends lists, cluster cities and candidates, and keeps notes out when asked', () => {
    const withNotes = disambiguationPrompt(input, false)
    expect(withNotes).toContain('Lists it is saved in: Istanbul')
    expect(withNotes).toContain('1. Starbucks')
    expect(withNotes).toContain('near the ferry')
    expect(disambiguationPrompt(input, true)).not.toContain('ferry')
  })

  it('clamps the answer and caches it', async () => {
    const model = stubModel(() => ({ index: 7, confidence: 3 }))
    const pick = aiDisambiguator(model, { model: 'm', excludeNotes: false })
    expect(await pick(input)).toEqual({ index: -1, confidence: 1 })
    await pick(input)
    expect(model.calls).toHaveLength(1)
  })
})

describe('aiClassifier', () => {
  const places: ClassifyInput[] = [
    { id: 'g1', title: 'Kronotrop', lists: ['Coffee'], notes: ['Ask for the filter of the day'], tags: [], osmTags: { amenity: 'cafe', cuisine: 'coffee_shop' } },
    { id: 'g2', title: 'Mystery Spot', lists: ['Want to go'], notes: [], tags: ['date night'] },
  ]
  const answer = () => ({
    places: [
      { id: 'g1', category: 'cafe', subcategory: 'coffee', aiTags: ['Specialty Coffee', 'good for work'], priceLevel: 2, summary: 'A specialty coffee bar.' },
      { id: 'g2', category: 'made-up', subcategory: 'zzz', aiTags: [], priceLevel: 9, summary: '' },
    ],
  })

  it('batches places, keeps answers inside the taxonomy, and caches per place', async () => {
    const model = stubModel(answer)
    const classify = aiClassifier(model, { model: 'm', excludeNotes: false })
    const out = await classify.classify(places)
    expect(out.get('g1')).toEqual({ category: 'cafe', subcategory: 'coffee', aiTags: ['specialty coffee', 'good for work'], priceLevel: 2, summary: 'A specialty coffee bar.' })
    expect(out.get('g2')).toEqual({ category: 'other', subcategory: undefined, aiTags: [], priceLevel: null, summary: undefined })
    expect(model.calls).toHaveLength(1)
    expect(model.calls[0]!.messages[1]!.content).toContain('Ask for the filter of the day')

    await classify.classify(places)
    expect(model.calls).toHaveLength(1)
  })

  it('never sends notes when the owner opted out', async () => {
    const model = stubModel(answer)
    await aiClassifier(model, { model: 'm', excludeNotes: true }).classify(places)
    expect(model.calls[0]!.messages[1]!.content).not.toContain('filter of the day')
  })

  it('cleanResult caps tags and drops overlong ones', () => {
    const r = cleanResult({ category: 'bar', subcategory: 'pub', aiTags: Array.from({ length: 12 }, (_, i) => `t${i}`).concat(['x'.repeat(40)]), priceLevel: 0 })
    expect(r.aiTags).toHaveLength(8)
    expect(r.priceLevel).toBeNull()
  })
})
