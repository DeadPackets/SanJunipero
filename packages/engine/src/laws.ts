import { z } from 'zod'
import type { SimConfig } from '@sj/shared'

// World laws are physics an operator may change while the world runs. The change
// is never a side-channel write to the config object: it lands as one
// `config_changed` event, folds into `state.laws`, and is therefore hashed,
// snapshotted and replayed like every other fact about the world.

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
}

export type LawQueue = Array<{ path: string; value: unknown }>

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
  const paths = Object.keys(laws)
  if (paths.length === 0) return base
  let perBase = memo.get(laws)
  if (perBase === undefined) { perBase = new WeakMap(); memo.set(laws, perBase) }
  const hit = perBase.get(base)
  if (hit !== undefined) return hit
  const out = { ...base } as unknown as Record<string, unknown>
  for (const path of paths.sort()) withPath(out, path, laws[path])
  const derived = out as unknown as SimConfig
  perBase.set(base, derived)
  return derived
}
