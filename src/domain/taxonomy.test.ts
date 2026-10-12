import { describe, expect, it } from 'vitest'
import { classifyByGoogleTypes } from './taxonomy'

describe('classifyByGoogleTypes', () => {
  it.each([
    ['steak_house', ['steak_house', 'restaurant', 'food'], 'food', 'restaurant'],
    ['ferris_wheel', ['ferris_wheel', 'tourist_attraction'], 'landmark', 'viewpoint'],
    ['historical_landmark', ['historical_landmark', 'tourist_attraction'], 'landmark', 'historic'],
    [undefined, ['sushi_restaurant', 'food'], 'food', 'restaurant'],
    ['supermarket', ['supermarket', 'grocery_store', 'store'], 'shopping', 'groceries'],
    [undefined, ['cell_phone_store', 'store'], 'shopping', undefined],
  ] as const)('%s %j -> %s', (primary, types, category, subcategory) => {
    expect(classifyByGoogleTypes(primary, [...types])).toEqual({ category, subcategory })
  })

  it('leaves generic places to other rules', () => {
    expect(classifyByGoogleTypes(undefined, ['point_of_interest', 'establishment'])).toBeNull()
  })
})
