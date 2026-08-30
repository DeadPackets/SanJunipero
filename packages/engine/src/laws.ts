import { z } from 'zod'
import type { SimConfig } from '@sj/shared'

// World laws are physics an operator may change while the world runs. Never a side-channel write
// to the config: it lands as one config_changed event, so it is hashed, snapshotted and replayed.

// Addendum §19's whitelist, path → the type the value must satisfy. A path that is
// not on this list cannot be changed at runtime by anyone, through any surface.
export const TOGGLABLE_PATHS: Readonly<Record<string, z.ZodType>> = {
  'reproduction.enabled': z.boolean(),
  'reproduction.coSleepNightsToPartner': z.number().int().positive(),
  'reproduction.partnerWindowDays': z.number().int().positive(),
  'reproduction.conceptionChancePerNight': z.number().min(0).max(1),
  'reproduction.gestationDays': z.number().int().positive(),
  'aging.deathOfOldAgeEnabled': z.boolean(),
  'spoilage.enabled': z.boolean(),
  'spoilage.days': z.record(z.string(), z.number().positive()),
  'spoilage.storehouseMultiplier': z.number().positive(),
  'tools.wearEnabled': z.boolean(),
  'seasons.winter.hungerDecayMultiplier': z.number().positive(),
  'seasons.winter.fishCatchMultiplier': z.number().min(0),
  'mystery.enabled': z.boolean(),
  'mystery.chancePerDay': z.number().min(0).max(1),
  'occlusion.enabled': z.boolean(),
  'ownership.enabled': z.boolean(),
  'inscription.enabled': z.boolean(),
  // Every section flag, so an operator can switch any of the deep world off mid-run.
  'mortality.enabled': z.boolean(),
  'illness.enabled': z.boolean(),
  'thirst.enabled': z.boolean(),
  'fertility.enabled': z.boolean(),
  'roads.enabled': z.boolean(),
  'desirePaths.enabled': z.boolean(),
  'fauna.enabled': z.boolean(),
  'warmth.enabled': z.boolean(),
  'light.enabled': z.boolean(),
  'nightWitness.enabled': z.boolean(),
  'foodVariety.enabled': z.boolean(),
  'regrowth.enabled': z.boolean(),
  'mapGrowth.enabled': z.boolean(),
  'constructs.enabled': z.boolean(),
  'constructs.minParticipants': z.number().int().positive(),
  // The dials tuning is expected to reach for.
  'mortality.poisonChanceSpoiled': z.number().min(0).max(1),
  'illness.dailyWorsenChance': z.number().min(0).max(1),
  'illness.contagionEnabled': z.boolean(),
  'illness.contagionChance': z.number().min(0).max(1),
  'thirst.decayFactorOfHunger': z.number().min(0).max(1),
  'desirePaths.wearThreshold': z.number().positive(),
  'light.nightWorkPenalty': z.number().positive(),
  'light.fireRiskPerTick': z.number().min(0).max(1),
  'nightWitness.nightFactor': z.number().min(0).max(1),
  'regrowth.saplingChancePerDay': z.number().min(0).max(1),
}

export type LawQueue = { path: string; value: unknown }[]

// Enqueue only. The tick wrapper drains this at the boundary and emits the events;
// nothing here touches state, so an operator can never land a change mid-tick.
export function applyLaw(queue: LawQueue, path: string, value: unknown): void {
  queue.push({ path, value })
}

function withPath(base: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let node = base
  for (const key of parts.slice(0, -1)) {
    const next = { ...(node[key] as Record<string, unknown>) }
    node[key] = next
    node = next
  }
  node[parts[parts.length - 1]!] = value
}

// Keyed on the identity of the `laws` object, which fold only replaces when a law
// actually changes — so a world with settled laws derives its config once, ever.
const memo = new WeakMap<object, WeakMap<object, SimConfig>>()

export function effectiveConfig(base: SimConfig, laws?: Record<string, unknown>): SimConfig {
  if (laws === undefined) return base
  const hit = memo.get(laws)?.get(base)
  if (hit !== undefined) return hit
  const paths = Object.keys(laws)
  if (paths.length === 0) return base
  const out = { ...base } as unknown as Record<string, unknown>
  for (const path of paths.sort()) withPath(out, path, laws[path])
  const derived = out as unknown as SimConfig
  let perBase = memo.get(laws)
  if (perBase === undefined) {
    perBase = new WeakMap()
    memo.set(laws, perBase)
  }
  perBase.set(base, derived)
  return derived
}
