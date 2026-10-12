import { describe, expect, it } from 'vitest'
import { TAXONOMY } from '../domain/taxonomy'
import { iconId } from './categoryIcons'

describe('iconId', () => {
  it('names a white and a colored icon for every category, and falls back to other', () => {
    for (const c of TAXONOMY) {
      expect(iconId(c.id, true)).toBe(`hx-cat-${c.id}-w`)
      expect(iconId(c.id, false)).toBe(`hx-cat-${c.id}-c`)
    }
    expect(iconId(undefined, true)).toBe('hx-cat-other-w')
    expect(iconId('made-up', false)).toBe('hx-cat-other-c')
  })
})
