import { describe, expect, it } from 'vitest'
import { SimConfigSchema } from '@sj/shared'
import {
  FISH_KIND,
  FOOD_KINDS,
  FOOD_NUTRITION,
  FORAGE_KIND,
  HERB_KIND,
  MUSHROOM_KIND,
  PALE_MUSHROOM,
  STEW_KIND,
  nutritionOf,
} from './food.js'

const CFG = SimConfigSchema.parse({})

// The other half of this law lives in the forge's catalog test: the food category there is
// asserted equal to this same set, so art and appetite cannot name the substance differently.
describe('the food registry', () => {
  it('names and prices exactly the kinds it registers', () => {
    for (const kind of [
      FORAGE_KIND,
      FISH_KIND,
      PALE_MUSHROOM,
      MUSHROOM_KIND,
      HERB_KIND,
      STEW_KIND,
    ])
      expect(FOOD_KINDS, kind).toContain(kind)
    expect(new Set(Object.keys(FOOD_NUTRITION))).toEqual(FOOD_KINDS)
  })

  // `isFoodKind` feeds a crop kind whether or not the registry lists it, and the catalogue is
  // locked to the registry — so a crop outside it is edible, undrawable and priced as a feast.
  it('registers every crop the config can grow', () => {
    for (const kind of Object.keys(CFG.crops)) expect(FOOD_KINDS, kind).toContain(kind)
    expect(nutritionOf(CFG, 'not_a_food')).toBe(1)
  })
})
