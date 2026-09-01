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
  isFoodKind,
  nutritionOf,
} from './food.js'

const CFG = SimConfigSchema.parse({})

// The other half of this law lives in the forge's catalog test: the food category there is
// asserted equal to this same set, so art and appetite cannot name the substance differently.
describe('the food registry', () => {
  it('eats every kind it registers', () => {
    for (const kind of FOOD_KINDS) expect(isFoodKind(CFG, kind), kind).toBe(true)
  })

  it('names only kinds it registers', () => {
    for (const kind of [
      FORAGE_KIND,
      FISH_KIND,
      PALE_MUSHROOM,
      MUSHROOM_KIND,
      HERB_KIND,
      STEW_KIND,
    ])
      expect(FOOD_KINDS, kind).toContain(kind)
    for (const kind of Object.keys(FOOD_NUTRITION)) expect(FOOD_KINDS, kind).toContain(kind)
  })

  it('feeds a crop kind that the registry does not list', () => {
    for (const kind of Object.keys(CFG.crops)) expect(isFoodKind(CFG, kind), kind).toBe(true)
    expect(nutritionOf(CFG, 'not_a_food')).toBe(1)
  })
})
