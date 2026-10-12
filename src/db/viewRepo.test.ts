import { beforeEach, describe, expect, it } from 'vitest'
import { freshDb } from '../test/db'
import { decodeFilters, emptyFilters, encodeFilters } from '../query/filters'
import { deleteView, listSavedViews, saveView } from './viewRepo'

beforeEach(() => {
  freshDb()
})

describe('saved views', () => {
  it('stores filters by name, replaces on the same name and deletes', async () => {
    const lisbon = encodeFilters({ ...emptyFilters(), cities: ['Lisbon'], categories: ['food'], status: ['wantToGo'] })
    const first = await saveView('Lisbon food, not visited', lisbon, 1)
    await saveView('Coffee', encodeFilters({ ...emptyFilters(), categories: ['cafe'] }), 2)
    expect((await listSavedViews()).map((v) => v.name)).toEqual(['Coffee', 'Lisbon food, not visited'])

    const replaced = await saveView('lisbon food, NOT visited ', encodeFilters({ ...emptyFilters(), cities: ['Lisbon'] }), 3)
    expect(replaced.id).toBe(first.id)
    expect(replaced.createdAt).toBe(1)
    expect(decodeFilters((await listSavedViews()).find((v) => v.id === first.id)!.query).categories).toEqual([])

    await deleteView(first.id)
    expect((await listSavedViews()).map((v) => v.name)).toEqual(['Coffee'])
  })
})
