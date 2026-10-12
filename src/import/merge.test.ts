import { describe, expect, it } from 'vitest'
import type { Membership, Place } from '../domain/types'
import { planImport, suggestRole, type ExistingState } from './merge'
import type { ParsedTakeout, SourceList } from './takeout'

const T0 = 1_700_000_000_000
const T1 = T0 + 86_400_000

function list(name: string, rows: SourceList['rows'], hash = name): SourceList {
  return { path: `Saved/${name}.csv`, listId: `l-${name}`, name, source: 'csv', hash, rows }
}

function parsed(...lists: SourceList[]): ParsedTakeout {
  return { lists, warnings: [], ignored: [] }
}

const empty: ExistingState = { places: new Map(), lists: new Map(), memberships: [], lastFileHashes: {} }

function stateFrom(plan: ReturnType<typeof planImport>, prev: ExistingState = empty): ExistingState {
  const places = new Map(prev.places)
  for (const p of plan.putPlaces) places.set(p.id, p)
  const lists = new Map(prev.lists)
  for (const l of plan.putLists) lists.set(l.id, l)
  const ms = new Map(prev.memberships.map((m) => [`${m.placeId}|${m.listId}`, m]))
  for (const m of plan.putMemberships) ms.set(`${m.placeId}|${m.listId}`, m)
  return { places, lists, memberships: [...ms.values()], lastFileHashes: plan.fileHashes }
}

describe('planImport', () => {
  it('creates one place per Google place even when it sits in several lists', () => {
    const plan = planImport(
      parsed(
        list('Want to go', [{ placeId: 'g1', title: 'Kedi Cafe', note: 'try the cake' }]),
        list('Coffee', [{ placeId: 'g1', title: 'Kedi Cafe' }, { placeId: 'g2', title: 'Owl Coffee' }]),
      ),
      empty,
      T0,
    )
    expect(plan.putPlaces.map((p) => p.id).sort()).toEqual(['g1', 'g2'])
    expect(plan.putMemberships).toHaveLength(3)
    expect(plan.counts).toMatchObject({ newPlaces: 2, newMemberships: 3, newLists: 2, needsResolve: 2 })
    expect(plan.putPlaces[0]!.firstSeenAt).toBe(T0)
    expect(plan.newListIds).toEqual(['l-Want to go', 'l-Coffee'])
  })

  it('marks places with coordinates as resolved', () => {
    const plan = planImport(parsed(list('Pins', [{ placeId: 'p1,2', title: 'Dropped pin', lat: 1, lng: 2, coordSource: 'url' }])), empty, T0)
    expect(plan.putPlaces[0]).toMatchObject({ resolveStatus: 'resolved', resolveConfidence: 1, coordSource: 'url' })
    expect(plan.resolveIds).toEqual([])
  })

  it('on re-import updates notes, removes missing rows and keeps enrichment', () => {
    const first = planImport(
      parsed(
        list('Want to go', [
          { placeId: 'g1', title: 'A', note: 'old' },
          { placeId: 'g2', title: 'B' },
        ], 'h1'),
      ),
      empty,
      T0,
    )
    const state = stateFrom(first)
    // Simulate enrichment from later pipeline stages.
    const enriched: Place = { ...state.places.get('g2')!, category: 'cafe', lat: 5, lng: 6, coordSource: 'geocoder', resolveStatus: 'resolved' }
    state.places.set('g2', enriched)

    const second = planImport(
      parsed(list('Want to go', [{ placeId: 'g1', title: 'A', note: 'new' }, { placeId: 'g3', title: 'C' }], 'h2')),
      state,
      T1,
    )
    expect(second.counts).toMatchObject({ newPlaces: 1, updatedPlaces: 1, newMemberships: 1, removedMemberships: 1 })
    const removed = second.putMemberships.find((m) => m.placeId === 'g2')!
    expect(removed.removedAt).toBe(T1)
    expect(second.putPlaces.find((p) => p.id === 'g2')).toBeUndefined() // place untouched
    expect(second.putMemberships.find((m) => m.placeId === 'g1')!.note).toBe('new')
    expect(second.putPlaces.find((p) => p.id === 'g3')!.firstSeenAt).toBe(T1)

    // The row comes back on a third import: membership restored.
    const third = planImport(
      parsed(list('Want to go', [{ placeId: 'g1', title: 'A', note: 'new' }, { placeId: 'g2', title: 'B' }, { placeId: 'g3', title: 'C' }], 'h3')),
      stateFrom(second, state),
      T1 + 1,
    )
    expect(third.counts.restoredMemberships).toBe(1)
    expect(third.putMemberships.find((m) => m.placeId === 'g2')!.removedAt).toBeUndefined()
  })

  it('skips files whose hash has not changed', () => {
    const first = planImport(parsed(list('A', [{ placeId: 'g1', title: 'x' }], 'same')), empty, T0)
    const second = planImport(parsed(list('A', [], 'same')), stateFrom(first), T1)
    expect(second.counts.skippedFiles).toBe(1)
    expect(second.putMemberships).toHaveLength(0)
  })

  it('never overwrites geocoder or manual coordinates with Google ones', () => {
    const place: Place = { id: 'g1', title: 'A', lat: 1, lng: 1, coordSource: 'manual', resolveStatus: 'manual', aiTags: [], firstSeenAt: T0, updatedAt: T0 }
    const state: ExistingState = { ...empty, places: new Map([['g1', place]]) }
    const plan = planImport(parsed(list('Starred', [{ placeId: 'g1', title: 'A', lat: 9, lng: 9, coordSource: 'takeout' }])), state, T1)
    expect(plan.putPlaces).toHaveLength(0)
  })

  it('warns about duplicate rows within one list', () => {
    const plan = planImport(parsed(list('A', [{ placeId: 'g1', title: 'x' }, { placeId: 'g1', title: 'x', rowNumber: 3 }])), empty, T0)
    expect(plan.warnings[0]).toMatch(/more than once \(row 3\)/)
    expect(plan.putMemberships).toHaveLength(1)
  })

  it('does not double count a place that is new in this import', () => {
    const plan = planImport(parsed(list('A', [{ placeId: 'g1', title: 'x', note: 'a' }]), list('B', [{ placeId: 'g1', title: 'x', note: 'b' }])), empty, T0)
    expect(plan.counts).toMatchObject({ newPlaces: 1, updatedPlaces: 0 })
  })

  it('puts feature ID points on the map but leaves them pending for refinement', () => {
    const plan = planImport(parsed(list('A', [{ placeId: 'g1', title: 'x', lat: 41, lng: 29, coordSource: 'fid' }])), empty, T0)
    expect(plan.putPlaces[0]).toMatchObject({ lat: 41, lng: 29, coordSource: 'fid', resolveStatus: 'pending' })
    expect(plan.putPlaces[0]!.resolveConfidence).toBeUndefined()
    expect(plan.resolveIds).toEqual(['g1'])
  })

  it('lets stronger Google coordinates replace weaker ones, never the reverse', () => {
    const fidRow = { placeId: 'g1', title: 'x', lat: 41, lng: 29, coordSource: 'fid' as const }
    const starRow = { placeId: 'g1', title: 'x', lat: 41.001, lng: 29.001, coordSource: 'takeout' as const }
    // Same import, either order: Saved Places.json wins.
    for (const lists of [[list('A', [fidRow]), list('S', [starRow])], [list('S', [starRow]), list('A', [fidRow])]]) {
      const plan = planImport(parsed(...lists), empty, T0)
      expect(plan.putPlaces[0]).toMatchObject({ lat: 41.001, coordSource: 'takeout', resolveStatus: 'resolved' })
    }
    // A later import with only the feature ID point leaves the better one alone.
    const state = stateFrom(planImport(parsed(list('S', [starRow])), empty, T0))
    const plan = planImport(parsed(list('A', [fidRow])), state, T1)
    expect(plan.putPlaces).toHaveLength(0)
  })

  it('keeps a title stable when two lists name the same place differently', () => {
    const istanbul = (title: string, hash: string) => list('Istanbul', [{ placeId: 'g1', title }], hash)
    const visited = (title: string, hash: string, extra: SourceList['rows'] = []) => list('Visited', [{ placeId: 'g1', title }, ...extra], hash)
    const first = planImport(parsed(istanbul('Galata Tower', 'i1'), visited('Galata Kulesi', 'v1')), empty, T0)
    expect(first.putPlaces[0]!.title).toBe('Galata Tower')
    expect(first.putMemberships.map((m) => m.title).sort()).toEqual(['Galata Kulesi', 'Galata Tower'])

    // Only Visited changed: the Turkish row must not flip the title.
    const s1 = stateFrom(first)
    const second = planImport(parsed(istanbul('Galata Tower', 'i1'), visited('Galata Kulesi', 'v2', [{ placeId: 'g2', title: 'Pandeli' }])), s1, T1)
    expect(second.counts).toMatchObject({ newPlaces: 1, updatedPlaces: 0 })
    expect(second.putPlaces.map((p) => p.id)).toEqual(['g2'])

    // Google renamed it everywhere: take the new name.
    const third = planImport(parsed(istanbul('Galata Tower Museum', 'i3'), visited('Galata Tower Museum', 'v3')), stateFrom(second, s1), T1 + 1)
    expect(third.putPlaces.find((p) => p.id === 'g1')!.title).toBe('Galata Tower Museum')
  })

  it('keeps the name Google filled in for a row exported without a title', () => {
    const state = stateFrom(planImport(parsed(list('Visited', [{ placeId: 'g1', title: 'Untitled place' }], 'v1')), empty, T0))
    state.places.set('g1', { ...state.places.get('g1')!, title: 'IBB Fatih Sports Centre' })
    const plan = planImport(parsed(list('Visited', [{ placeId: 'g1', title: 'Untitled place' }, { placeId: 'g2', title: 'New' }], 'v2')), state, T1)
    expect(plan.putPlaces.map((p) => p.id)).toEqual(['g2'])
  })

  it('does not create lists for empty collections but still empties known lists', () => {
    const none = planImport(parsed(list('Images', [])), empty, T0)
    expect(none.putLists).toHaveLength(0)
    expect(none.counts.newLists).toBe(0)

    const state = stateFrom(planImport(parsed(list('Trip', [{ placeId: 'g1', title: 'x' }], 'h1')), empty, T0))
    const emptied = planImport(parsed(list('Trip', [], 'h2')), state, T1)
    expect(emptied.putMemberships).toMatchObject([{ placeId: 'g1', removedAt: T1 }])
  })

  it('keeps existing memberships for lists not in the import', () => {
    const m: Membership = { placeId: 'g9', listId: 'l-Other', addedAt: T0 }
    const plan = planImport(parsed(list('A', [{ placeId: 'g1', title: 'x' }])), { ...empty, memberships: [m] }, T1)
    expect(plan.putMemberships.some((x) => x.placeId === 'g9')).toBe(false)
  })
})

describe('suggestRole', () => {
  it.each([
    ['Visited', 'visited'],
    ['Want to go', 'wantToGo'],
    ['Travel plans', 'wantToGo'],
    ['Lisbon trip', 'wantToGo'],
    ['Favorite places', 'favorite'],
    ['Gittiklerim', 'visited'],
    ['Coffee ☕', 'other'],
  ] as const)('%s -> %s', (name, role) => {
    expect(suggestRole(name, 'csv')).toBe(role)
  })
  it('starred places default to favorite', () => expect(suggestRole('Starred places', 'starred')).toBe('favorite'))
})
