// Phase 0 spike: run 20 of your places through two or three OpenRouter models
// with the real classification prompt, and compare their answers side by side.
//
//   OPENROUTER_API_KEY=sk-or-... npm run compare-models -- model/a model/b model/c
//
// Uses the places in data/accuracy/resolution.json (npm run accuracy builds
// it), with Google's type as a reference. Costs a few cents per model.
import 'fake-indexeddb/auto'
import { existsSync, readFileSync } from 'node:fs'
import { aiClassifier, type ClassifyInput } from '../src/pipeline/ai'
import { classifyByGoogleTypes } from '../src/domain/taxonomy'
import { OpenRouterClient } from '../src/services/openrouter'

const models = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const key = process.env.OPENROUTER_API_KEY ?? ''
const SET = 'data/accuracy/resolution.json'
if (!key || !models.length) {
  console.error('Usage: OPENROUTER_API_KEY=... npm run compare-models -- <model> [<model> ...]')
  process.exit(1)
}
if (!existsSync(SET)) {
  console.error(`No ${SET}; run npm run accuracy -- data/Takeout first.`)
  process.exit(1)
}

const truth = (JSON.parse(readFileSync(SET, 'utf8')) as { fid: string; title: string; types: string[]; primaryType?: string }[]).slice(0, 20)
const inputs: ClassifyInput[] = truth.map((t) => ({ id: t.fid, title: t.title, lists: [], notes: [], tags: [], googleTypes: t.types }))
const reference = new Map(truth.map((t) => [t.fid, classifyByGoogleTypes(t.primaryType, t.types)?.category]))
const client = new OpenRouterClient(key)

const results = new Map<string, Map<string, { category: string; aiTags: string[]; summary?: string }>>()
for (const model of models) {
  const started = Date.now()
  try {
    results.set(model, await aiClassifier(client, { model, excludeNotes: true }).classify(inputs))
    const agree = inputs.filter((p) => reference.get(p.id) && results.get(model)!.get(p.id)?.category === reference.get(p.id)).length
    const judged = inputs.filter((p) => reference.get(p.id)).length
    console.log(`${model}: ${((Date.now() - started) / 1000).toFixed(1)} s, agrees with Google's type on ${agree} of ${judged}`)
  } catch (err) {
    console.log(`${model}: failed (${err instanceof Error ? err.message : String(err)})`)
  }
}

for (const p of inputs) {
  console.log(`\n${p.title}  [google: ${reference.get(p.id) ?? '?'}]`)
  for (const model of models) {
    const r = results.get(model)?.get(p.id)
    console.log(`  ${model.padEnd(36)} ${r ? `${r.category.padEnd(10)} ${r.aiTags.join(', ')}${r.summary ? `  | ${r.summary}` : ''}` : '-'}`)
  }
}
