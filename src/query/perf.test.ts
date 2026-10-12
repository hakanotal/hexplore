import { describe, expect, it } from 'vitest'
import { buildDemoData } from '../dev/demoData'
import { computeStats } from '../stats/compute'
import { applyFilters, emptyFilters } from './filters'
import { buildViews } from './placeView'
import { createIndex, search } from './search'
import { toSearchDocs } from './searchDocs'
import { SpatialIndex } from './spatial'

// The plan's budgets at 10,000 places (docs/plan.md, Performance targets).
// Medians of a few runs keep this steady on a busy CI machine.

function median(fn: () => unknown, runs = 7): number {
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    fn()
    times.push(performance.now() - t)
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)]!
}

describe('performance at 10,000 places', () => {
  const data = buildDemoData(10_000)
  const views = buildViews({ ...data, userData: [] })
  const istanbul = views.find((v) => v.place.city === 'Istanbul')!

  it('builds the views once per load', () => {
    expect(views.length).toBeGreaterThan(9_000)
    expect(median(() => buildViews({ ...data, userData: [] }), 3)).toBeLessThan(250)
  })

  it('applies a filter change in under 100 ms', () => {
    const f = { ...emptyFilters(), categories: ['food', 'cafe'], status: ['wantToGo' as const], openNow: true, near: { lat: istanbul.lat!, lng: istanbul.lng!, km: 5 } }
    expect(median(() => applyFilters(views, f))).toBeLessThan(100)
    expect(median(() => applyFilters(views, emptyFilters()))).toBeLessThan(100)
  })

  it('answers a text search keystroke in under 30 ms', () => {
    const index = createIndex(toSearchDocs(views))
    expect(median(() => search(index, 'kadikoy cof'))).toBeLessThan(30)
  })

  it('sorts by distance in under 50 ms', () => {
    const spatial = new SpatialIndex(views)
    expect(median(() => spatial.nearest(istanbul.lat!, istanbul.lng!))).toBeLessThan(50)
  })

  it('computes stats well within a worker frame budget', () => {
    expect(median(() => computeStats({ ...data, userData: [], imports: [] }), 3)).toBeLessThan(400)
  })
})
