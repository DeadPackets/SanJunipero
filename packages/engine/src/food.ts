import { type SimConfig } from '@sj/shared'

// The world's one food registry: eat validates against it, forage/fish/harvest spawn from it.
export const FORAGE_KIND = 'berries'
export const FISH_KIND = 'fish'
export const PALE_MUSHROOM = 'pale_mushroom'
export const MUSHROOM_KIND = 'mushroom'
export const HERB_KIND = 'herb'
export const STEW_KIND = 'stew'
export const FOOD_KINDS: ReadonlySet<string> = new Set([
  FORAGE_KIND,
  FISH_KIND,
  'venison',
  'rabbit_meat',
  'bread',
  'wheat',
  MUSHROOM_KIND,
  PALE_MUSHROOM,
  HERB_KIND,
  STEW_KIND,
])

// A share of needs.eatRestoreHunger, code and not a dial: SimConfigSchema is closed. An
// unlisted kind is a full meal.
export const FOOD_NUTRITION: Readonly<Record<string, number>> = {
  [HERB_KIND]: 0.05,
  [MUSHROOM_KIND]: 0.4,
  [PALE_MUSHROOM]: 0.4,
  [FORAGE_KIND]: 0.5,
  wheat: 0.5,
  [FISH_KIND]: 0.75,
  rabbit_meat: 0.75,
  venison: 1,
  bread: 1,
  [STEW_KIND]: 1.5,
}

export function nutritionOf(_config: SimConfig, kind: string): number {
  return FOOD_NUTRITION[kind] ?? 1
}

export function isFoodKind(config: SimConfig, kind: string): boolean {
  return FOOD_KINDS.has(kind) || config.crops[kind] !== undefined
}
