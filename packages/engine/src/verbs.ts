import { z } from 'zod'
import {
  classMembers, dayPhaseFromTick, fertilityAt, glowRadiusFor, inputName, litSourceWithin,
  MINUTES_PER_DAY, simTimeFromTick, WATER_TILES,
  type RecipeDef, type SimConfig, type StructureRecipeDef,
} from '@sj/shared'
import { mintId, type Affliction, type Item, type TileId, type WorldState } from './state.js'
import type { RngStream } from './rng.js'
import { doorTile, sameInterior } from './interiors.js'
import { bridgeAt, BRIDGE_KIND, findPath, isPassable, searchPath } from './path.js'
import { claimInWorld, townSquareOf } from './town.js'
import { isSpoiling, spoilageFor } from './systems/spoilage.js'
import { fleeTo } from './systems/fauna.js'
import { HEAT_SOURCE_KINDS } from './systems/warmth.js'
import { FAUNA_YIELD, type FaunaKind } from './data/faunaDefs.js'
import { FORAGEABLE_YIELD } from './data/forageables.js'

export type PendingEvent = { type: string; payload: unknown }
export type VerbKind =
  | 'walk' | 'sleep' | 'wake' | 'enter' | 'exit' | 'eat' | 'tend' | 'till' | 'plant' | 'harvest' | 'fish' | 'forage'
  | 'build' | 'craft' | 'extinguish' | 'drink' | 'fill' | 'hunt' | 'wear' | 'doff'
  | 'kindle' | 'snuff' | 'stoke' | 'chop'
  | 'speak' | 'give' | 'take' | 'stow' | 'write' | 'read' | 'inscribe' | 'teach' | 'attack' | 'experiment'

export type VerbDef = {
  kind: string
  validate(state: WorldState, config: SimConfig, agentId: string, params: Record<string, unknown>): string | null
  duration(state: WorldState, config: SimConfig, agentId: string, params: Record<string, unknown>): number
  onStart?(state: WorldState, config: SimConfig, agentId: string, params: Record<string, unknown>): PendingEvent[]
  onComplete(state: WorldState, config: SimConfig, agentId: string, params: Record<string, unknown>, rng: RngStream): PendingEvent[]
  results?(state: WorldState, config: SimConfig, agentId: string, params: Record<string, unknown>): Record<string, unknown>
  interruptible: boolean
  skill?: { track: string; xp: number }
  rngStream?: string
}

// Fills the defaults nearly every verb repeats: one-tick duration, interruptible.
function makeVerb(spec: Omit<VerbDef, 'duration' | 'interruptible'> & Partial<Pick<VerbDef, 'duration' | 'interruptible'>>): VerbDef {
  return { duration: () => 1, interruptible: true, ...spec }
}

// Adjacent = Chebyshev distance <= 1 to any footprint tile (standing on it counts).
export function isAdjacentToRect(ax: number, ay: number, rect: { x: number; y: number; w: number; h: number }): boolean {
  return ax >= rect.x - 1 && ax <= rect.x + rect.w && ay >= rect.y - 1 && ay <= rect.y + rect.h
}

export function isFoodKind(config: SimConfig, kind: string): boolean {
  return FOOD_KINDS.has(kind) || config.crops[kind] !== undefined
}

// Shared validate block for verbs aimed at another agent. Reason strings are
// per-verb; `busy` (teach) is checked between the alive and adjacency checks.
function adjacentLivingTarget(
  state: WorldState, agentId: string, targetId: string,
  reasons: { self: string; gone: string; busy?: string; far: string },
): string | null {
  if (targetId === agentId) return reasons.self
  const target = state.agents[targetId]
  if (!target || !target.alive) return reasons.gone
  if (reasons.busy !== undefined && target.activity) return reasons.busy
  const a = state.agents[agentId]!
  // A refusal must leave a door open (addendum §9): the one thing missing is two paces, so
  // the answer says which two. Zero tends and one give across five live runs (C11 R21).
  if (Math.abs(a.x - target.x) > 1 || Math.abs(a.y - target.y) > 1) {
    return `${reasons.far} — they are at (${target.x}, ${target.y})`
  }
  return null
}

export const WalkParams = z.object({ x: z.number().int(), y: z.number().int() }).strict()

export function ticksPerTile(state: WorldState, config: SimConfig, agentId: string): number {
  const a = state.agents[agentId]!
  const debuffed = Object.values(a.needs).some((v) => v < config.needs.debuffThreshold)
  return debuffed ? config.movement.debuffTicksPerTile : config.movement.baseTicksPerTile
}

const walk: VerbDef = makeVerb({
  kind: 'walk',
  validate(state, config, agentId, params) {
    const p = WalkParams.safeParse(params)
    if (!p.success) return 'walk needs a destination {x, y}'
    const a = state.agents[agentId]!
    if (a.insideId !== undefined) return 'you are indoors; step outside first'
    if (a.x === p.data.x && a.y === p.data.y) return 'already at that spot'
    if (findPath(state, a, p.data, config) === null) return 'no path to that spot'
    return null
  },
  duration(state, config, agentId, params) {
    const p = WalkParams.parse(params)
    const a = state.agents[agentId]!
    const path = findPath(state, a, p, config)
    if (!path) throw new Error(`walk.duration: no path for ${agentId}`)
    return path.length * ticksPerTile(state, config, agentId)
  },
  onComplete() { return [] },
})

// A walk the search could not finish inside its budget. The legs still go, and they stop short
// of where the mind aimed them — which is a thing the body can tell, and the only thing it can.
export function walkIsCapped(state: WorldState, config: SimConfig, agentId: string): boolean {
  const a = state.agents[agentId]
  if (!a?.activity || a.activity.verb !== 'walk') return false
  const p = WalkParams.safeParse(a.activity.params)
  return p.success && searchPath(state, a, p.data, config)?.capped === true
}

export const EatParams = z.object({ itemId: z.string() }).strict()

// Single food registry: eat validates against it, forage/fish/harvest spawn from it.
export const FORAGE_KIND = 'berries'
export const FISH_KIND = 'fish'
// Both edible, and that is the point: from across the clearing they are the same mushroom, and
// which one kills is knowledge the town has to earn. `rabbit_meat` is the hunt's smaller catch.
export const PALE_MUSHROOM = 'pale_mushroom'
export const MUSHROOM_KIND = 'mushroom'
export const HERB_KIND = 'herb'
export const STEW_KIND = 'stew'
export const FOOD_KINDS: ReadonlySet<string> = new Set([
  FORAGE_KIND, FISH_KIND, 'venison', 'rabbit_meat', 'bread', 'wheat', MUSHROOM_KIND, PALE_MUSHROOM, HERB_KIND,
  STEW_KIND,
])

// What a kind is worth at the table, as a share of `needs.eatRestoreHunger`. A module const,
// not a dial: `SimConfigSchema` is closed after Task 2. An unlisted kind is a full meal, which
// is what every crop the config names has always been.
// The herb's 0.05 is the point of the table: chewing a remedy is not dinner.
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

// The worst thing wrong with a body: highest severity, ties to the alphabetically first kind.
// The list is already stored in kind order, so a strictly-greater scan is that tiebreak.
export function worstAffliction(state: WorldState, agentId: string): Affliction | undefined {
  let worst: Affliction | undefined
  for (const x of state.agents[agentId]?.afflictions ?? []) {
    if (worst === undefined || x.severity > worst.severity) worst = x
  }
  return worst
}

// One relief, whether it was chewed or pressed into a patient's hands (G4).
export function relieveWorst(state: WorldState, agentId: string, amount: number): PendingEvent[] {
  const worst = worstAffliction(state, agentId)
  if (worst === undefined) return []
  const left = worst.severity - amount
  return [left > 0
    ? { type: 'affliction_worsened', payload: { agentId, kind: worst.kind, severity: left } }
    : { type: 'affliction_recovered', payload: { agentId, kind: worst.kind } }]
}

// A body that has already gone down does not get to pick its bed — and neither does one that
// is only just still upright. Rest a body must fall over to earn is a ratchet: it was 74% of
// the last live gate's refusals and half of its completed acts (C11 ruling R-C, R15 half 2).
function mayLieDownRough(state: WorldState, config: SimConfig, agentId: string): boolean {
  const a = state.agents[agentId]!
  return a.collapsedSinceTick !== null || a.needs.energy < config.needs.debuffThreshold
}

const sleep: VerbDef = makeVerb({
  kind: 'sleep',
  validate(state, config, agentId) {
    const a = state.agents[agentId]!
    if (a.asleep) return 'already asleep'
    if (!config.structures.sleepIndoorsOnly || mayLieDownRough(state, config, agentId)) return null
    const s = a.insideId === undefined ? undefined : state.structures[a.insideId]
    if (!s || s.stage !== 'complete' || !config.structures.sleepableKinds.includes(s.kind)) {
      return 'there is no bed here; find somewhere to lie down — weary enough and the bare ground will do'
    }
    return null
  },
  onComplete(state, _config, agentId) {
    // A night lifts the ladder as well as the counter, and lifts it EVERY time. Recovery that
    // works once is a body that can only ever wear out; sleep is what answers wearing out
    // (R15 half 1). The herb keeps working and is no longer the only thing that does.
    const weary = state.agents[agentId]?.afflictions?.some((x) => x.kind === 'fatigue') ?? false
    return [
      { type: 'agent_slept', payload: { agentId } },
      ...(weary ? [{ type: 'affliction_recovered', payload: { agentId, kind: 'fatigue' } }] : []),
    ]
  },
})

export const EnterParams = z.object({ structureId: z.string() }).strict()

const enter: VerbDef = makeVerb({
  kind: 'enter',
  validate(state, config, agentId, params) {
    const p = EnterParams.safeParse(params)
    if (!p.success) return 'enter needs a {structureId}'
    const a = state.agents[agentId]!
    if (a.insideId !== undefined) return 'already inside'
    const s = state.structures[p.data.structureId]
    if (!s) return 'there is nothing there to enter'
    if (!config.structures.enterableKinds.includes(s.kind)) return `there is no way into a ${s.kind}`
    if (s.stage !== 'complete') return 'it is not finished'
    const door = doorTile(state, s)
    if (!door) return 'there is no way in'
    if (Math.abs(a.x - door.x) > 1 || Math.abs(a.y - door.y) > 1) return 'not close enough to the door'
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = EnterParams.parse(params)
    const s = state.structures[p.structureId]
    const door = s ? doorTile(state, s) : null
    if (!door) return []
    return [
      { type: 'agent_moved', payload: { id: agentId, x: door.x, y: door.y } },
      { type: 'agent_entered', payload: { agentId, structureId: p.structureId } },
    ]
  },
})

const exit: VerbDef = makeVerb({
  kind: 'exit',
  validate(state, _config, agentId) {
    return state.agents[agentId]!.insideId === undefined ? 'not inside anything' : null
  },
  onComplete(state, _config, agentId) {
    const structureId = state.agents[agentId]!.insideId
    return structureId === undefined ? [] : [{ type: 'agent_exited', payload: { agentId, structureId } }]
  },
})

// submitIntent already prepends agent_woke for any intent from a sleeper.
const wake: VerbDef = makeVerb({
  kind: 'wake',
  validate(state, _config, agentId) {
    return state.agents[agentId]!.asleep ? null : 'not asleep'
  },
  onComplete() { return [] },
})

// What a meal is worth to THIS body right now: the kind's own nutrition, then a mild bonus for
// every distinct kind the window still remembers. The one derivation of both (G4).
export function mealRestore(state: WorldState, config: SimConfig, agentId: string, kind: string): number {
  if (!config.foodVariety.enabled) return config.needs.eatRestoreHunger
  const kinds = new Set((state.agents[agentId]?.recentFoods ?? []).map((m) => m.kind))
  kinds.add(kind)
  const bonus = Math.min(config.foodVariety.maxBonus, config.foodVariety.bonusPerKind * (kinds.size - 1))
  return config.needs.eatRestoreHunger * nutritionOf(config, kind) * (1 + bonus)
}

// In the hands, or close enough to put there in the same motion (C11 R-I): the founders' bread
// woke up on a shelf and their hands woke up empty, and once the hunger line started saying
// where the loaf was, `eat: not holding that` rose 2 → 18. Reaching for supper is not a turn.
function mealInHand(state: WorldState, agentId: string, itemId: string): Item | undefined {
  const item = state.items[itemId]
  if (!item) return undefined
  if (item.loc.t === 'agent') return item.loc.id === agentId ? item : undefined
  return itemWithinReach(state, agentId, item) ? item : undefined
}

const eat: VerbDef = makeVerb({
  kind: 'eat',
  validate(state, config, agentId, params) {
    const p = EatParams.safeParse(params)
    if (!p.success) return 'eat needs an {itemId}'
    const item = state.items[p.data.itemId]
    if (!item) return 'not holding that'
    if (item.loc.t === 'agent' && item.loc.id !== agentId) return 'someone is holding that'
    if (mealInHand(state, agentId, p.data.itemId) === undefined) {
      return 'not holding that — go and stand beside it first'
    }
    if (!isFoodKind(config, item.kind)) return `${item.kind} is not food`
    return null
  },
  // The kind rides `action_completed`, which is what the fold counts the window by. It is
  // recorded before the belly fills, so the meal in hand counts toward its own variety.
  results(state, _config, agentId, params) {
    const p = EatParams.safeParse(params)
    const item = p.success ? mealInHand(state, agentId, p.data.itemId) : undefined
    return item === undefined ? {} : { kind: item.kind }
  },
  rngStream: 'illness',
  onComplete(state, config, agentId, params, rng) {
    const p = EatParams.parse(params)
    const item = mealInHand(state, agentId, p.itemId)
    if (item === undefined) return []
    // A pale mushroom is always a gamble; anything else only on its last day. The roll is
    // drawn once, here at emission, and never when the meal is safe — a fresh loaf must not
    // move the stream, or two worlds that ate differently would diverge for no reason.
    const risky = config.mortality.enabled
      && (item.kind === PALE_MUSHROOM || isSpoiling(state, item, config))
      && rng.next() < config.mortality.poisonChanceSpoiled
    return [
      // The hand closes before the mouth opens, and it closes exactly as `take` closes it.
      ...liftEvents(state, config, agentId, p.itemId),
      ...(risky
        ? [{ type: 'agent_afflicted', payload: { agentId, kind: 'poison', severity: 1, itemId: p.itemId } }]
        : []),
      ...(item.kind === HERB_KIND ? relieveWorst(state, agentId, config.mortality.herbRelief) : []),
      { type: 'item_qty_changed', payload: { id: p.itemId, delta: -1 } },
      {
        type: 'need_changed',
        payload: { id: agentId, need: 'hunger', delta: mealRestore(state, config, agentId, item.kind) },
      },
    ]
  },
})

export const TendParams = z.object({ targetId: z.string(), itemId: z.string().optional() }).strict()

// An hour, not a scribble: three ticks, the C9 carving precedent.
const TEND_TICKS = 3

const tend: VerbDef = makeVerb({
  kind: 'tend',
  duration: () => TEND_TICKS,
  validate(state, config, agentId, params) {
    const p = TendParams.safeParse(params)
    if (!p.success) return 'tend needs a {targetId}'
    const bad = adjacentLivingTarget(state, agentId, p.data.targetId, {
      self: 'cannot tend yourself', gone: 'no one there to tend', far: 'not adjacent to the patient',
    })
    if (bad) return bad
    if (!sameInterior(state, agentId, p.data.targetId)) return 'a wall is in the way'
    const target = state.agents[p.data.targetId]!
    if (!target.ill && target.hp >= config.health.maxHp && (target.afflictions?.length ?? 0) === 0) return 'nothing to tend'
    if (p.data.itemId !== undefined) {
      const item = state.items[p.data.itemId]
      if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
      if (item.kind !== HERB_KIND) return `${item.kind} is not a remedy`
    }
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = TendParams.parse(params)
    const target = state.agents[p.targetId]
    const a = state.agents[agentId]!
    if (!target || !target.alive) return []
    if (Math.abs(a.x - target.x) > 1 || Math.abs(a.y - target.y) > 1) return []
    const item = p.itemId === undefined ? undefined : state.items[p.itemId]
    const offered = item !== undefined && item.kind === HERB_KIND
      && item.loc.t === 'agent' && item.loc.id === agentId
    return [
      { type: 'agent_tended', payload: { agentId: p.targetId, tenderId: agentId, ...(offered ? { itemId: p.itemId } : {}) } },
      // Given, not swallowed: the same leaf does twice as much in another body's hands.
      ...(offered
        ? [
          { type: 'item_qty_changed', payload: { id: p.itemId, delta: -1 } },
          ...relieveWorst(state, p.targetId, config.mortality.herbRelief * 2),
        ]
        : []),
    ]
  },
  skill: { track: 'medicine', xp: 1 },
})

export { WATER_TILES }
export const BUCKET_KIND = 'bucket'
export const VESSEL_KINDS: ReadonlySet<string> = new Set(['waterskin', BUCKET_KIND])
export const WELL_KIND = 'well'

export function waterWithinReach(state: WorldState, agentId: string): 'water_tile' | 'well' | null {
  const a = state.agents[agentId]!
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = state.terrain[a.y + dy]?.[a.x + dx]
      if (t !== undefined && WATER_TILES.has(t)) return 'water_tile'
    }
  }
  for (const id of Object.keys(state.structures).sort()) {
    const s = state.structures[id]!
    if (s.kind === WELL_KIND && s.stage === 'complete' && isAdjacentToRect(a.x, a.y, s)) return 'well'
  }
  return null
}

export const DrinkParams = z.object({ itemId: z.string().optional() }).strict()

const drink: VerbDef = makeVerb({
  kind: 'drink',
  validate(state, _config, agentId, params) {
    const p = DrinkParams.safeParse(params)
    if (!p.success) return 'drink takes an optional {itemId}'
    if (p.data.itemId !== undefined) {
      const item = state.items[p.data.itemId]
      if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
      if (!VESSEL_KINDS.has(item.kind)) return 'nothing to drink from'
      if ((item.charges ?? 0) <= 0) return 'the skin is empty'
      return null
    }
    if (waterWithinReach(state, agentId) === null) return 'no water within reach'
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = DrinkParams.parse(params)
    if (p.itemId !== undefined) {
      const item = state.items[p.itemId]
      if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId || (item.charges ?? 0) <= 0) return []
      return [{ type: 'agent_drank', payload: { agentId, source: 'item', itemId: p.itemId } }]
    }
    const source = waterWithinReach(state, agentId)
    if (source === null) return []
    return [{ type: 'agent_drank', payload: { agentId, source } }]
  },
})

// A bucket carries one dose and it is heavy: it is the firefighting unit, not a canteen.
export const BUCKET_CHARGES = 1

export const FillParams = z.object({ itemId: z.string() }).strict()

const fill: VerbDef = makeVerb({
  kind: 'fill',
  validate(state, _config, agentId, params) {
    const p = FillParams.safeParse(params)
    if (!p.success) return 'fill needs an {itemId}'
    const item = state.items[p.data.itemId]
    if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
    if (!VESSEL_KINDS.has(item.kind)) return 'that holds no water'
    if (waterWithinReach(state, agentId) === null) return 'no water within reach'
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = FillParams.parse(params)
    const item = state.items[p.itemId]
    if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId) return []
    if (!VESSEL_KINDS.has(item.kind) || waterWithinReach(state, agentId) === null) return []
    const charges = item.kind === BUCKET_KIND ? BUCKET_CHARGES : config.thirst.waterskinCharges
    return [{ type: 'item_filled', payload: { itemId: p.itemId, charges } }]
  },
})

export const WearParams = z.object({ itemId: z.string() }).strict()

// What counts as clothing is what the world knows how to be warmed by: `warmth.insulation` is
// the one table of it (G4), so a kind nobody can be warmed by is a kind nobody can wear.
export function isWearable(config: SimConfig, kind: string): boolean {
  return (config.warmth.insulation as Record<string, number | undefined>)[kind] !== undefined
}

const wear: VerbDef = makeVerb({
  kind: 'wear',
  validate(state, config, agentId, params) {
    const p = WearParams.safeParse(params)
    if (!p.success) return 'wear needs an {itemId}'
    const item = state.items[p.data.itemId]
    if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
    if (!isWearable(config, item.kind)) return 'that is not something you can wear'
    if (state.agents[agentId]!.equipped?.body !== undefined) return 'you are already wearing something'
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = WearParams.parse(params)
    const item = state.items[p.itemId]
    if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId) return []
    if (!isWearable(config, item.kind) || state.agents[agentId]!.equipped?.body !== undefined) return []
    return [{ type: 'item_equipped', payload: { agentId, itemId: p.itemId, slot: 'body' } }]
  },
})

const doff: VerbDef = makeVerb({
  kind: 'doff',
  validate(state, _config, agentId) {
    return state.agents[agentId]!.equipped?.body === undefined ? 'you are not wearing anything' : null
  },
  onComplete(state, _config, agentId) {
    const itemId = state.agents[agentId]!.equipped?.body
    return itemId === undefined ? [] : [{ type: 'item_unequipped', payload: { agentId, itemId } }]
  },
})

export const KindleParams = z.object({ itemId: z.string() }).strict()
export const StokeParams = z.object({ structureId: z.string() }).strict()

// A thing you can carry and set alight: it glows, and it is not a building. One table of what
// glows (`light.glowRadius`) answers both halves, so a codified lantern needs no second list.
export function isKindleable(config: SimConfig, kind: string): boolean {
  return glowRadiusFor(config, kind) !== undefined && !HEAT_SOURCE_KINDS.has(kind)
}

// What is left in this torch: a full one has never been struck, a snuffed one remembers.
export function fuelLeft(item: { fuelTicks?: number }, config: SimConfig): number {
  return item.fuelTicks ?? config.light.torchBurnTicks
}

const kindle: VerbDef = makeVerb({
  kind: 'kindle',
  validate(state, config, agentId, params) {
    const p = KindleParams.safeParse(params)
    if (!p.success) return 'kindle needs an {itemId}'
    const item = state.items[p.data.itemId]
    if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
    if (!isKindleable(config, item.kind)) return 'that will not take a flame'
    if (item.litUntilTick !== undefined) return 'it is already lit'
    if (fuelLeft(item, config) <= 0) return 'it is burnt out'
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = KindleParams.parse(params)
    const item = state.items[p.itemId]
    if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId) return []
    if (!isKindleable(config, item.kind) || item.litUntilTick !== undefined) return []
    const left = fuelLeft(item, config)
    if (left <= 0) return []
    return [{ type: 'item_lit', payload: { itemId: p.itemId, burnsUntilTick: state.tick + left } }]
  },
})

const snuff: VerbDef = makeVerb({
  kind: 'snuff',
  validate(state, _config, agentId, params) {
    const p = KindleParams.safeParse(params)
    if (!p.success) return 'snuff needs an {itemId}'
    const item = state.items[p.data.itemId]
    if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
    if (item.litUntilTick === undefined) return 'it is not lit'
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = KindleParams.parse(params)
    const item = state.items[p.itemId]
    if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId || item.litUntilTick === undefined) return []
    return [{ type: 'item_snuffed', payload: { itemId: p.itemId } }]
  },
})

export const FUEL_KIND = 'wood'

const stoke: VerbDef = makeVerb({
  kind: 'stoke',
  validate(state, _config, agentId, params) {
    const p = StokeParams.safeParse(params)
    if (!p.success) return 'stoke needs a {structureId}'
    const s = state.structures[p.data.structureId]
    if (!s || !HEAT_SOURCE_KINDS.has(s.kind)) return 'there is no fire there to feed'
    if (s.stage !== 'complete') return 'it is not finished'
    if (!nearRect(state, agentId, s.x, s.y, s.w, s.h)) return 'not close enough to the fire'
    if (heldQty(state, agentId, FUEL_KIND) < 1) return shortOf(FUEL_KIND)
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = StokeParams.parse(params)
    const s = state.structures[p.structureId]
    if (!s || !HEAT_SOURCE_KINDS.has(s.kind) || heldQty(state, agentId, FUEL_KIND) < 1) return []
    return [
      ...consumeHeld(state, agentId, FUEL_KIND, 1),
      { type: 'structure_fueled', payload: { structureId: p.structureId, burnsUntilTick: state.tick + config.light.fuelBurnTicks } },
    ]
  },
})

// The five things hands do that eyes have to be part of. Speech, walking and everything else
// cost the same in the dark as at noon — the night is a price change, not a curfew.
export const NIGHT_WORK_VERBS: ReadonlySet<string> = new Set(['build', 'craft', 'till', 'pave', 'dig_channel'])

// Working blind: night, no flame within reach, and the light law switched on.
export function fumblesInTheDark(state: WorldState, config: SimConfig, agentId: string): boolean {
  if (!config.light.enabled) return false
  if (dayPhaseFromTick(state.tick) !== 'night') return false
  const a = state.agents[agentId]
  if (a === undefined) return false
  return !litSourceWithin(state, a.x, a.y, state.tick, config, config.light.workRadius)
}

// The one derivation of what the dark costs (G4): submitIntent multiplies a duration by it,
// and perception says so out loud. Never a refusal — burning fuel or burning time is a choice.
export function workPenalty(state: WorldState, config: SimConfig, agentId: string, verb: string): number {
  return NIGHT_WORK_VERBS.has(verb) && fumblesInTheDark(state, config, agentId)
    ? config.light.nightWorkPenalty
    : 1
}

export const TileParams = z.object({ x: z.number().int(), y: z.number().int() }).strict()
export const PlantParams = z.object({ x: z.number().int(), y: z.number().int(), kind: z.string() }).strict()
export const HarvestParams = z.object({ cropId: z.string() }).strict()

function tileAt(state: WorldState, x: number, y: number): TileId | null {
  return state.terrain[y]?.[x] ?? null
}

function withinReach(state: WorldState, agentId: string, x: number, y: number): boolean {
  const a = state.agents[agentId]!
  return Math.abs(a.x - x) <= 1 && Math.abs(a.y - y) <= 1
}

export function skillLevel(state: WorldState, agentId: string, track: string, config: SimConfig): number {
  const xp = state.agents[agentId]!.skills[track] ?? 0
  return Math.min(config.skills.maxLevel, Math.floor(xp / config.skills.xpLevelDivisor))
}

const till: VerbDef = makeVerb({
  kind: 'till',
  validate(state, _config, agentId, params) {
    const p = TileParams.safeParse(params)
    if (!p.success) return 'till needs a tile {x, y}'
    const tile = tileAt(state, p.data.x, p.data.y)
    if (tile !== 0 && tile !== 1) return 'only grass or dirt can be tilled'
    if (!withinReach(state, agentId, p.data.x, p.data.y)) return 'not close enough to till'
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = TileParams.parse(params)
    return [{ type: 'tile_changed', payload: { x: p.x, y: p.y, from: tileAt(state, p.x, p.y), to: 6, reason: 'tilled', byId: agentId } }]
  },
  skill: { track: 'farming', xp: 1 },
})

// Digging is slower than scratching a furrow: four ticks with a spade's worth of effort.
const DIG_CHANNEL_TICKS = 4

// Water only runs downhill from water. A channel spreads one tile at a time from the river
// or from what has already been cut, which is why irrigation is a project and not a wish.
const digChannel: VerbDef = makeVerb({
  kind: 'dig_channel',
  duration: () => DIG_CHANNEL_TICKS,
  validate(state, _config, agentId, params) {
    const p = TileParams.safeParse(params)
    if (!p.success) return 'dig_channel needs a tile {x, y}'
    const tile = tileAt(state, p.data.x, p.data.y)
    if (tile !== 0 && tile !== 1) return 'only grass or dirt can be dug out'
    if (!withinReach(state, agentId, p.data.x, p.data.y)) return 'not close enough to dig'
    const fed = [[0, -1], [-1, 0], [1, 0], [0, 1]].some(([dx, dy]) => {
      const t = tileAt(state, p.data.x + dx!, p.data.y + dy!)
      return t !== null && WATER_TILES.has(t)
    })
    if (!fed) return 'no water reaches here'
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = TileParams.parse(params)
    return [{ type: 'tile_changed', payload: { x: p.x, y: p.y, from: tileAt(state, p.x, p.y), to: 10, reason: 'channel', byId: agentId } }]
  },
  skill: { track: 'farming', xp: 1 },
})

const plant: VerbDef = makeVerb({
  kind: 'plant',
  validate(state, config, agentId, params) {
    const p = PlantParams.safeParse(params)
    if (!p.success) return 'plant needs {x, y, kind}'
    if (tileAt(state, p.data.x, p.data.y) !== 6) return 'crops need farmland'
    if (!config.crops[p.data.kind]) return `no such crop: ${p.data.kind}`
    if (!withinReach(state, agentId, p.data.x, p.data.y)) return 'not close enough to plant'
    for (const c of Object.values(state.crops)) {
      if (!c.withered && c.x === p.data.x && c.y === p.data.y) return 'that plot is already planted'
    }
    return null
  },
  onComplete(state, _config, _agentId, params) {
    const p = PlantParams.parse(params)
    const plantedDay = Math.floor(state.tick / MINUTES_PER_DAY)
    return [{ type: 'crop_planted', payload: { id: mintId(state, 'crop'), kind: p.kind, x: p.x, y: p.y, plantedDay } }]
  },
  skill: { track: 'farming', xp: 1 },
})

const harvest: VerbDef = makeVerb({
  kind: 'harvest',
  validate(state, config, agentId, params) {
    const p = HarvestParams.safeParse(params)
    if (!p.success) return 'harvest needs a {cropId}'
    const crop = state.crops[p.data.cropId]
    if (!crop) return 'no such crop'
    if (crop.withered) return 'the crop has withered'
    const def = config.crops[crop.kind]
    if (!def || crop.stage !== def.stages - 1) return 'not ripe yet'
    if (!withinReach(state, agentId, crop.x, crop.y)) return 'not close enough to harvest'
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = HarvestParams.parse(params)
    const crop = state.crops[p.cropId]!
    const def = config.crops[crop.kind]!
    // Water near the roots is worth more than skill at the sickle: the ground decides the number.
    const qty = Math.floor(def.yield * fertilityAt(state.terrain, crop.x, crop.y, config))
    return [
      { type: 'crop_harvested', payload: { cropId: p.cropId } },
      { type: 'item_spawned', payload: { id: mintId(state, 'item'), kind: crop.kind, qty, loc: { t: 'agent', id: agentId }, ...ownerStamp(config, agentId), ...spoilageFor(state, crop.kind, config) } },
    ]
  },
  skill: { track: 'farming', xp: 1 },
})

// How far from the cast a school still counts as "where the fish are".
export const FISH_SCHOOL_RADIUS = 2

// The school a cast reaches, if any: the nearest one in id order. Gated on the fauna law, so
// with the entity layer off the C9 catch chance is exactly what it always was.
export function schoolNear(
  state: WorldState, config: SimConfig, x: number, y: number,
): { id: string; stock: number } | null {
  if (!config.fauna.enabled) return null
  for (const id of Object.keys(state.fauna ?? {}).sort()) {
    const f = state.fauna![id]!
    if (f.kind !== 'fish' || !f.alive) continue
    if (Math.max(Math.abs(f.x - x), Math.abs(f.y - y)) > FISH_SCHOOL_RADIUS) continue
    return { id, stock: f.stock ?? 1 }
  }
  return null
}

// The one derivation of a cast's odds (G4): season and school compose on top of skill, which
// is why winter's 0.5 and a school's 2x cancel to exactly the plain-day chance.
export function fishCatchChance(
  state: WorldState, config: SimConfig, agentId: string, x: number, y: number,
): number {
  const winter = simTimeFromTick(state.tick).season === 'winter'
  return config.wildlife.fishCatchBase
    * (1 + skillLevel(state, agentId, 'fishing', config) / 10)
    * (winter ? config.seasons.winter.fishCatchMultiplier : 1)
    * (schoolNear(state, config, x, y) === null ? 1 : config.fauna.fishSchoolBonus)
}

const fish: VerbDef = makeVerb({
  kind: 'fish',
  validate(state, _config, agentId, params) {
    const p = TileParams.safeParse(params)
    if (!p.success) return 'fish needs a water tile {x, y}'
    if (tileAt(state, p.data.x, p.data.y) !== 2) return 'no water there'
    if (!withinReach(state, agentId, p.data.x, p.data.y)) return 'not close enough to the water'
    return null
  },
  onComplete(state, config, agentId, params, rng) {
    if (state.wildlife.fish <= 0) return []
    const p = TileParams.parse(params)
    const school = schoolNear(state, config, p.x, p.y)
    if (rng.next() >= fishCatchChance(state, config, agentId, p.x, p.y)) return []
    return [
      // A school is a place the fish are, not a second stock of them: both books move.
      ...(school === null
        ? []
        : [school.stock > 1
            ? { type: 'fauna_stock_changed', payload: { id: school.id, stock: school.stock - 1 } }
            : { type: 'fauna_killed', payload: { id: school.id, kind: 'fish', x: p.x, y: p.y, byId: agentId } }]),
      { type: 'wildlife_changed', payload: { fish: state.wildlife.fish - 1 } },
      { type: 'item_spawned', payload: { id: mintId(state, 'item'), kind: FISH_KIND, qty: 1, loc: { t: 'agent', id: agentId }, ...ownerStamp(config, agentId), ...spoilageFor(state, FISH_KIND, config) } },
    ]
  },
  skill: { track: 'fishing', xp: 1 },
  rngStream: 'wildlife',
})

export const HuntParams = z.object({ faunaId: z.string() }).strict()

// What the world was authored with. A recipe may add to it and can never take from it, so a
// codified spear arrives without anybody re-authoring the knife.
export const WEAPON_KINDS: ReadonlySet<string> = new Set(['knife'])

// The one reader of the weapon list (G4): the module's own kinds plus whatever a recipe row
// declares it makes. `weaponKinds` is absent from every authored row, so at world defaults
// this is `WEAPON_KINDS` exactly (C11 Task 37, batch-4 ruling 1).
export function weaponKindsFor(config: SimConfig): ReadonlySet<string> {
  const out = new Set(WEAPON_KINDS)
  for (const row of Object.values(config.crafting.recipes)) {
    for (const kind of row.weaponKinds ?? []) out.add(kind)
  }
  return out
}
// A school is not hunted; it is fished. These two are what a knife and a close approach can take.
export const HUNTABLE_KINDS: ReadonlySet<FaunaKind> = new Set<FaunaKind>(['deer', 'rabbit'])

// Skill against the animal's difficulty: a novice takes one deer in four, and enough seasons at
// it make the approach certain. Rolled at emission from the `fauna` stream.
export function huntChance(state: WorldState, config: SimConfig, agentId: string, kind: 'deer' | 'rabbit'): number {
  const difficulty = config.fauna.huntDifficulty[kind]
  return Math.min(1, (1 + skillLevel(state, agentId, 'foraging', config)) / (1 + difficulty))
}

const hunt: VerbDef = makeVerb({
  kind: 'hunt',
  validate(state, config, agentId, params) {
    const p = HuntParams.safeParse(params)
    if (!p.success) return 'hunt needs a {faunaId}'
    const f = state.fauna?.[p.data.faunaId]
    if (!f || !f.alive) return 'nothing there to hunt'
    if (!HUNTABLE_KINDS.has(f.kind)) return 'that is not something you can run down'
    const a = state.agents[agentId]!
    if (Math.max(Math.abs(a.x - f.x), Math.abs(a.y - f.y)) > 1) return 'too far off to reach'
    const weapons = weaponKindsFor(config)
    if (!Object.values(state.items).some(
      (i) => weapons.has(i.kind) && i.loc.t === 'agent' && i.loc.id === agentId,
    )) return 'you have nothing to hunt with'
    return null
  },
  onComplete(state, config, agentId, params, rng) {
    const p = HuntParams.parse(params)
    const f = state.fauna?.[p.faunaId]
    if (!f || !f.alive || !HUNTABLE_KINDS.has(f.kind)) return []
    const a = state.agents[agentId]!
    if (Math.max(Math.abs(a.x - f.x), Math.abs(a.y - f.y)) > 1) return []
    if (rng.next() >= huntChance(state, config, agentId, f.kind as 'deer' | 'rabbit')) {
      const to = fleeTo(state, f.kind, f, a)
      if (to.x === f.x && to.y === f.y) return []
      return [{ type: 'fauna_moved', payload: { moves: [{ id: p.faunaId, x: to.x, y: to.y }] } }]
    }
    return [
      { type: 'fauna_killed', payload: { id: p.faunaId, kind: f.kind, x: f.x, y: f.y, byId: agentId } },
      ...FAUNA_YIELD[f.kind].map((y, i) => ({
        type: 'item_spawned',
        payload: {
          id: mintId(state, 'item', i), kind: y.kind, qty: y.qty, loc: { t: 'agent', id: agentId },
          ...ownerStamp(config, agentId), ...spoilageFor(state, y.kind, config),
        },
      })),
    ]
  },
  skill: { track: 'foraging', xp: 1 },
  rngStream: 'fauna',
})

// Naming a node is optional, and that is the whole of the backward compatibility: an empty
// `{}` is still C9's "gather from the wood beside you", event for event.
export const ForageParams = z.object({ nodeId: z.string().optional() }).strict()

const forage: VerbDef = makeVerb({
  kind: 'forage',
  validate(state, _config, agentId, params) {
    const p = ForageParams.safeParse(params)
    if (!p.success) return 'forage takes an optional {nodeId}'
    if (p.data.nodeId !== undefined) {
      const node = state.forageables?.[p.data.nodeId]
      if (!node) return 'nothing of the kind there'
      if (node.stock <= 0) return 'there is nothing left to take here'
      if (!withinReach(state, agentId, node.x, node.y)) {
        return `not close enough to gather — the patch is at (${node.x}, ${node.y}); stand beside it`
      }
      return null
    }
    const a = state.agents[agentId]!
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (tileAt(state, a.x + dx, a.y + dy) === 3) return null
      }
    }
    return 'no forest nearby — berries, mushrooms and herbs grow in patches, and a patch is gathered by name once you can see one'
  },
  onComplete(state, config, agentId, params) {
    const p = ForageParams.parse(params)
    if (p.nodeId !== undefined) {
      const node = state.forageables?.[p.nodeId]
      if (!node || node.stock <= 0) return []
      const kind = FORAGEABLE_YIELD[node.kind]
      return [
        node.stock > 1
          ? { type: 'forageable_stock_changed', payload: { id: p.nodeId, stock: node.stock - 1 } }
          : { type: 'forageable_depleted', payload: { id: p.nodeId } },
        { type: 'item_spawned', payload: { id: mintId(state, 'item'), kind, qty: 1, loc: { t: 'agent', id: agentId }, ...ownerStamp(config, agentId), ...spoilageFor(state, kind, config) } },
      ]
    }
    const { season } = simTimeFromTick(state.tick)
    const qty = config.wildlife.forageYieldBySeason[season]
    if (qty <= 0) return []
    return [
      { type: 'item_spawned', payload: { id: mintId(state, 'item'), kind: FORAGE_KIND, qty, loc: { t: 'agent', id: agentId }, ...ownerStamp(config, agentId), ...spoilageFor(state, FORAGE_KIND, config) } },
    ]
  },
  skill: { track: 'foraging', xp: 1 },
})

// What you pull out of the ground, the water or the woods — or write down — is yours from the
// first moment. Making is making, whatever the hand does.
function ownerStamp(config: SimConfig, agentId: string): { owner?: string } {
  return config.ownership.enabled ? { owner: agentId } : {}
}

// A mark is a claim like any other, so it rides the same flag. Skill is read at
// craft time: the hand that was expert on the day is the hand the object remembers.
export function crafterStamp(
  state: WorldState, config: SimConfig, agentId: string, track: string,
): { crafterMark?: string } {
  if (!config.ownership.enabled) return {}
  return skillLevel(state, agentId, track, config) >= config.crafting.expertLevel ? { crafterMark: agentId } : {}
}

// ★ A BUILD DOES NOT TAKE A COORDINATE — NOT IN A TOWN.
//
// The grammar's spacing floor (86.1626 px, proven exhaustively over 2 496 pairings) holds
// BECAUSE every building goes on a plot of the lattice. An agent that can name a coordinate
// can break it, so the two shapes below are the whole of the seam: in a town, `build` accepts
// `{kind}` and NOTHING ELSE — a strict object with no `x` and no `y` in it, so a coordinate is
// not a thing the act can be given. `onStart` reads the site from `claimInWorld` and never
// from the params, so even a hand-written event cannot seat a roof off the lattice.
//
// A world with no town in it is the other shape. Every fixture in the repository is a meadow
// with a shed on it, and a meadow has no plots; there, a build names its own ground exactly as
// it always has. That is not a hole in the invariant, it is the invariant's domain — a world
// with no lattice has no lattice to break.
export const SitedBuildParams = z.object({ kind: z.string(), x: z.number().int(), y: z.number().int() }).strict()
export const PlottedBuildParams = z.object({ kind: z.string() }).strict()
/** The loose reader for the stages after `validate`, which has already judged the shape. */
export const BuildParams = z.object({
  kind: z.string(), x: z.number().int().optional(), y: z.number().int().optional(),
}).strict()
export const CraftParams = z.object({ recipe: z.string() }).strict()
export const ExtinguishParams = z.object({ structureId: z.string() }).strict()

function heldStacks(state: WorldState, agentId: string, kind: string) {
  return Object.keys(state.items).sort()
    .map((id) => state.items[id]!)
    .filter((i) => i.kind === kind && i.loc.t === 'agent' && i.loc.id === agentId)
}

function heldQty(state: WorldState, agentId: string, kind: string): number {
  return heldStacks(state, agentId, kind).reduce((sum, i) => sum + i.qty, 0)
}

function consumeHeld(state: WorldState, agentId: string, kind: string, qty: number): PendingEvent[] {
  const events: PendingEvent[] = []
  let left = qty
  for (const i of heldStacks(state, agentId, kind)) {
    if (left <= 0) break
    const take = Math.min(i.qty, left)
    events.push({ type: 'item_qty_changed', payload: { id: i.id, delta: -take } })
    left -= take
  }
  return events
}

function nearRect(state: WorldState, agentId: string, x: number, y: number, w: number, h: number): boolean {
  const a = state.agents[agentId]!
  return isAdjacentToRect(a.x, a.y, { x, y, w, h })
}

// The in-progress construction site at exactly (x, y), if any.
function siteAt(state: WorldState, x: number, y: number) {
  for (const id of Object.keys(state.structures).sort()) {
    const s = state.structures[id]!
    if (s.x === x && s.y === y && s.stage === 'construction') return s
  }
  return null
}

// What can be built at all: a row with materials on it. An empty `inputs` marks a kind the
// world places and nobody raises — a grave is not a building project.
export function buildableRecipe(config: SimConfig, kind: string): StructureRecipeDef | null {
  const row = config.structures.recipes[kind]
  return row !== undefined && Object.keys(row.inputs).length > 0 ? row : null
}

// The house keeps its C9 dial as the duration source; every other kind reads its row. The two
// are asserted equal in config.test.ts, so this is one number under two names, not two numbers.
export function buildTicks(config: SimConfig, kind: string): number {
  return kind === 'house' ? config.construction.houseTicks : (config.structures.recipes[kind]?.durationTicks ?? 0)
}

function buildableGroundRefusal(state: WorldState, x: number, y: number, w: number, h: number): string | null {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (!isPassable(state, x + dx, y + dy)) return 'cannot build there'
    }
  }
  return null
}

// A bank is anything that is not open water — or a deck already laid over it.
function banked(state: WorldState, x: number, y: number): boolean {
  const tile = state.terrain[y]?.[x]
  if (tile === undefined) return false
  return !WATER_TILES.has(tile) || bridgeAt(state, x, y)
}

// Two or three tiles of deck, every one of them over water, and a foot on solid ground at each
// end. Longer than that and it is a causeway, which is more than six planks can hold up.
const BRIDGE_SPAN = { min: 2, max: 3 }

function bridgeSiteRefusal(state: WorldState, x: number, y: number, w: number, h: number): string | null {
  const span = w === 1 ? h : h === 1 ? w : 0
  if (span < BRIDGE_SPAN.min || span > BRIDGE_SPAN.max) return 'no bridge that shape will stand'
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tile = state.terrain[y + dy]?.[x + dx]
      if (tile === undefined || !WATER_TILES.has(tile)) return 'a bridge belongs over water'
      if (bridgeAt(state, x + dx, y + dy)) return 'that spot is taken'
    }
  }
  const ends = w === 1
    ? [{ x, y: y - 1 }, { x, y: y + h }]
    : [{ x: x - 1, y }, { x: x + w, y }]
  if (!ends.every((e) => banked(state, e.x, e.y))) return 'both ends must reach something solid'
  return null
}

type BuildSite = { kind: string; x: number; y: number }

// Everything about a site that depends on how big the thing standing on it is.
function footprintRefusal(
  state: WorldState, config: SimConfig, agentId: string, d: BuildSite, w: number, h: number,
): string | null {
  const recipe = buildableRecipe(config, d.kind)!
  if (!nearRect(state, agentId, d.x, d.y, w, h)) return `not close enough to build — stand within reach of (${d.x}, ${d.y})`
  const site = siteAt(state, d.x, d.y)
  if (site && site.kind === d.kind) return null // resume: materials already spent
  for (const s of Object.values(state.structures)) {
    if (d.x < s.x + s.w && s.x < d.x + w && d.y < s.y + s.h && s.y < d.y + h) return 'that spot is taken'
  }
  const ground = d.kind === BRIDGE_KIND
    ? bridgeSiteRefusal(state, d.x, d.y, w, h)
    : buildableGroundRefusal(state, d.x, d.y, w, h)
  if (ground) return ground
  for (const a of Object.values(state.agents)) {
    if (a.alive && a.x >= d.x && a.x < d.x + w && a.y >= d.y && a.y < d.y + h) return 'someone is in the way'
  }
  for (const [kind, qty] of Object.entries(recipe.inputs)) {
    if (heldQty(state, agentId, kind) < qty) return shortOf(kind)
  }
  return null
}

// A recipe's w and h are a shape, not a compass bearing: a deck written three long and one
// wide is the same deck turned sideways. As written wins; the turned reading is tried only
// when the written one refuses, and a refusal is always the written one's words. Deterministic,
// so validate, duration and onStart all reach for the same rectangle.
export function buildFootprint(
  state: WorldState, config: SimConfig, agentId: string, d: BuildSite,
): { w: number; h: number; refusal: string | null } {
  const { w, h } = buildableRecipe(config, d.kind)!
  const written = footprintRefusal(state, config, agentId, d, w, h)
  if (written === null || w === h) return { w, h, refusal: written }
  const turned = footprintRefusal(state, config, agentId, d, h, w)
  return turned === null ? { w: h, h: w, refusal: null } : { w, h, refusal: written }
}

/** A bridge stands on the water and the water decides where it can stand; everything else a
 *  pair of hands raises stands on the town's ground, and the town decides. Those are the only
 *  two site rules this file has ever had — `bridgeSiteRefusal` is the older one. */
export const isPlottedKind = (kind: string): boolean => kind !== BRIDGE_KIND

/** Whether THIS world seats THIS kind on a plot. It takes a town to seat one. */
export function buildIsPlotted(state: WorldState, kind: string): boolean {
  return isPlottedKind(kind) && townSquareOf(state) !== null
}

/** The site this agent already has half-raised, so a build that was interrupted goes back to
 *  the same walls instead of claiming a second plot. Keyed on the BUILDER, because on a plot
 *  there is no coordinate to look one up by. */
function ownSite(state: WorldState, agentId: string, kind: string) {
  for (const id of Object.keys(state.structures).sort()) {
    const s = state.structures[id]!
    if (s.stage === 'construction' && s.kind === kind && s.builtBy === agentId) return s
  }
  return null
}

export type BuildSiteAnswer = {
  site: { x: number; y: number; w: number; h: number } | null
  /** The standing construction this build continues, if any: its materials are already spent. */
  resume: { id: string; progressTicks: number } | null
  refusal: string | null
}

const words = (kind: string): string => kind.replace(/_/g, ' ')

/**
 * ★ THE ONE ANSWER TO "WHERE DOES THIS GO", and the reason a mind cannot choose.
 *
 * On a plot, nothing about the asker reaches the site: it is the free plot nearest the square,
 * `claimInWorld` decides it, and the params are not consulted at all. The builder still has to
 * be standing at it — a house is not raised by wishing — and the refusal SAYS WHERE, which is
 * the addendum §9 shape every other refusal in this file already uses. A seam that fails by
 * offering nothing is invisible; this one fails by naming a place to walk to.
 */
export function buildSiteOf(
  state: WorldState, config: SimConfig, agentId: string, params: { kind: string; x?: number; y?: number },
): BuildSiteAnswer {
  const recipe = buildableRecipe(config, params.kind)!
  if (!buildIsPlotted(state, params.kind)) {
    if (params.x === undefined || params.y === undefined) {
      return { site: null, resume: null, refusal: `build needs {kind, x, y}` }
    }
    const d = { kind: params.kind, x: params.x, y: params.y }
    const { w, h, refusal } = buildFootprint(state, config, agentId, d)
    const at = siteAt(state, d.x, d.y)
    return {
      site: { x: d.x, y: d.y, w, h },
      resume: at !== null && at.kind === d.kind ? { id: at.id, progressTicks: at.progressTicks } : null,
      refusal,
    }
  }
  const mine = ownSite(state, agentId, params.kind)
  const claim = claimInWorld(state, { along: recipe.w, deep: recipe.h })
  const site = mine !== null ? { x: mine.x, y: mine.y, w: mine.w, h: mine.h } : claim?.site ?? null
  if (site === null) {
    return { site: null, resume: null, refusal: `there is nowhere left in the town for a ${words(params.kind)}` }
  }
  const resume = mine === null ? null : { id: mine.id, progressTicks: mine.progressTicks }
  // ★ THE DOOR TILE, not the corner of the footprint — the spot on the street the new frontage
  // will face. It is a road, it is passable, and it is adjacent to EVERY mass the plot can
  // hold, so one number answers the question whatever is being raised. The same number
  // `groundForBuilding` puts in the perception, so a mind is never told two places.
  const stand = claim?.door ?? { x: site.x, y: site.y + site.h }
  const go = `go and stand at (${stand.x}, ${stand.y})`
  if (!nearRect(state, agentId, site.x, site.y, site.w, site.h)) {
    return { site, resume, refusal: `the town keeps ground for a ${words(params.kind)} — ${go}` }
  }
  return {
    site, resume,
    refusal: resume !== null ? null : plottedRefusal(state, config, agentId, params.kind, site, go),
  }
}

/** Where the town has room for the next roof, as a place to walk to — the plot's own street
 *  corner. `null` for a world with no town, or a town with nothing left to offer. Every plot
 *  in the lattice holds every legal mass, so this is one answer for every buildable kind. */
export function groundForBuilding(state: WorldState): { x: number; y: number } | null {
  return claimInWorld(state, { along: 1, deep: 1 })?.door ?? null
}

/** Everything that can still be wrong once the town has named the ground. */
function plottedRefusal(
  state: WorldState, config: SimConfig, agentId: string, kind: string,
  site: { x: number; y: number; w: number; h: number }, go: string,
): string | null {
  const ground = buildableGroundRefusal(state, site.x, site.y, site.w, site.h)
  if (ground) return ground
  for (const a of Object.values(state.agents)) {
    if (!a.alive) continue
    if (a.x < site.x || a.x >= site.x + site.w || a.y < site.y || a.y >= site.y + site.h) continue
    // A body inside the footprint would be walled in by its own walls. Standing ON the ground
    // is the near miss the door tile exists to prevent, so that refusal points at the door.
    return a.id === agentId ? `you are standing on the ground itself — ${go}` : 'someone is in the way'
  }
  for (const [k, qty] of Object.entries(buildableRecipe(config, kind)!.inputs)) {
    if (heldQty(state, agentId, k) < qty) return shortOf(k)
  }
  return null
}

const build: VerbDef = makeVerb({
  kind: 'build',
  validate(state, config, agentId, params) {
    const kind = (params as { kind?: unknown }).kind
    if (typeof kind !== 'string') return 'build needs {kind, x, y}'
    if (buildableRecipe(config, kind) === null) return `cannot build a ${kind}`
    const plotted = buildIsPlotted(state, kind)
    const p = (plotted ? PlottedBuildParams : SitedBuildParams).safeParse(params)
    // ★ THE LOUD HALF. The prompt tells a mind that a roof goes where the town has ground for
    // it; a mind that names a coordinate anyway is told plainly that it does not get to.
    if (!p.success) {
      return plotted
        ? `build needs {kind} — where a ${words(kind)} stands is the town's to say, not yours`
        : 'build needs {kind, x, y}'
    }
    return buildSiteOf(state, config, agentId, p.data).refusal
  },
  duration(state, config, agentId, params) {
    const p = BuildParams.parse(params)
    return buildTicks(config, p.kind) - (buildSiteOf(state, config, agentId, p).resume?.progressTicks ?? 0)
  },
  onStart(state, config, agentId, params) {
    const p = BuildParams.parse(params)
    const recipe = buildableRecipe(config, p.kind)
    if (recipe === null) return []
    const answer = buildSiteOf(state, config, agentId, p)
    if (answer.resume !== null || answer.site === null) return []
    const { x, y, w, h } = answer.site
    return [
      ...Object.entries(recipe.inputs).flatMap(([kind, qty]) => consumeHeld(state, agentId, kind, qty)),
      {
        type: 'structure_planned',
        payload: {
          id: mintId(state, 'structure'), kind: p.kind, x, y, w, h,
          maxHp: recipe.maxHp, flammable: recipe.flammable, builderId: agentId,
          ...(config.ownership.enabled ? { owner: agentId } : {}),
        },
      },
    ]
  },
  onComplete(state, config, agentId, params) {
    const p = BuildParams.parse(params)
    const site = buildSiteOf(state, config, agentId, p).resume
    return site ? [{ type: 'structure_completed', payload: { id: site.id } }] : []
  },
  skill: { track: 'carpentry', xp: 1 },
})

// The one recipe the world ships knowing (§9 genesis rulebook). It is code and not a dial,
// because `SimConfigSchema` closed at Task 2 — and it wants two things a config row cannot
// say: a fire somebody is feeding, and a vessel with water in it.
export type SeedRecipe = RecipeDef & { atFire?: true; water?: number }

export const SEED_RECIPES: Readonly<Record<string, SeedRecipe>> = {
  [STEW_KIND]: {
    inputs: { any_meat: 1, any_vegetable: 1 },
    output: { kind: STEW_KIND, qty: 1 },
    skill: 'cooking',
    atFire: true,
    water: 1,
  },
  // The hunter's road to a warm back. `crafting.recipes` already holds the weaver's road
  // (fiber → cloth → garment) and closed at Task 2, so the one that skips the loom lives
  // here. The name has to differ from the row it stands beside; the thing it makes does not.
  hide_garment: {
    inputs: { hide: 2 },
    output: { kind: 'garment', qty: 1 },
    skill: 'tailoring',
  },
  // A stick and a wrap of dry reed. Until this row the only flame in the world was the one
  // the founders were given, and `kindle` had nothing to strike.
  torch: {
    inputs: { wood: 1, fiber: 1 },
    output: { kind: 'torch', qty: 1 },
    skill: 'carpentry',
  },
}

export function recipeFor(config: SimConfig, name: string): SeedRecipe | undefined {
  return config.crafting.recipes[name] ?? SEED_RECIPES[name]
}

// A mind asks for the THING, not the road to it: "craft garment" with two hides in hand must
// not be told there is no cloth. Precedence is unchanged — the row that owns the name is
// always tried first — and every other route makes the same product. Deterministic by key
// order, so two towns holding the same larder take the same road.
export function craftRoutes(config: SimConfig, name: string): SeedRecipe[] {
  const named = recipeFor(config, name)
  const product = named?.output.kind ?? name
  const routes = named === undefined ? [] : [named]
  for (const key of Object.keys(SEED_RECIPES).sort()) {
    const seed = SEED_RECIPES[key]!
    if (seed !== named && seed.output.kind === product) routes.push(seed)
  }
  return routes
}

// What a pair of hands can raise and what it can shape, off the same two tables `build` and
// `craft` already validate against. No new physics: this is the vocabulary those verbs have
// always accepted, gathered in one place so somebody can finally be told it (C11 R-H).
export type MakeableRoad = { inputs: Record<string, number>; atFire?: true; water?: number }
export type Makeables = {
  builds: Array<{ kind: string; inputs: Record<string, number> }>
  crafts: Array<{ name: string; roads: MakeableRoad[] }>
}

export function makeables(config: SimConfig): Makeables {
  const builds = Object.keys(config.structures.recipes).sort().flatMap((kind) => {
    const row = buildableRecipe(config, kind)
    return row === null ? [] : [{ kind, inputs: row.inputs }]
  })
  // One word per product, because `craftRoutes` already lets one word reach every road to it:
  // "garment" finds the loom and the hide, where `hide_garment` would have found only the hide.
  const products = new Set<string>()
  for (const name of [...Object.keys(config.crafting.recipes), ...Object.keys(SEED_RECIPES)]) {
    products.add(recipeFor(config, name)?.output.kind ?? name)
  }
  const crafts = [...products].sort().map((name) => ({
    name,
    roads: craftRoutes(config, name).map((r) => ({
      inputs: r.inputs,
      ...(r.atFire === true ? { atFire: true as const } : {}),
      ...(r.water === undefined ? {} : { water: r.water }),
    })),
  }))
  return { builds, crafts }
}

// How much of an input the hands hold, counting every member when the input is a canon class.
function heldForInput(state: WorldState, agentId: string, input: string): number {
  const members = classMembers(input)
  if (members === undefined) return heldQty(state, agentId, input)
  return members.reduce((sum, kind) => sum + heldQty(state, agentId, kind), 0)
}

// Spend an input, taking from the class members in kind order so two towns holding the same
// larder always cook the same pot.
function consumeForInput(state: WorldState, agentId: string, input: string, qty: number): PendingEvent[] {
  const members = classMembers(input)
  if (members === undefined) return consumeHeld(state, agentId, input, qty)
  const events: PendingEvent[] = []
  let left = qty
  for (const kind of [...members].sort()) {
    if (left <= 0) break
    const take = Math.min(heldQty(state, agentId, kind), left)
    if (take <= 0) continue
    events.push(...consumeHeld(state, agentId, kind, take))
    left -= take
  }
  return events
}

const heldWater = (state: WorldState, agentId: string) =>
  Object.keys(state.items).sort().map((id) => state.items[id]!)
    .find((i) => i.loc.t === 'agent' && i.loc.id === agentId && VESSEL_KINDS.has(i.kind) && (i.charges ?? 0) > 0)

// A fire somebody is feeding, within arm's reach of where the cooking happens.
function keptFireInReach(state: WorldState, agentId: string): boolean {
  for (const id of Object.keys(state.structures).sort()) {
    const s = state.structures[id]!
    if (!HEAT_SOURCE_KINDS.has(s.kind) || s.stage !== 'complete') continue
    if ((s.fueledUntilTick ?? 0) <= state.tick) continue
    if (nearRect(state, agentId, s.x, s.y, s.w, s.h)) return true
  }
  return false
}

// Where a material comes from, for the refusal that says a pair of hands is short of one.
// The emergence law's first lever is refusal prose that teaches a path, and the live gate
// answered "not enough meat" to a town that had never seen an animal (C11 R21).
const MATERIAL_SOURCE: Readonly<Record<string, string>> = {
  meat: 'meat comes off an animal you have hunted, or a fish out of the water',
  vegetables: 'a vegetable comes from a berry patch, a mushroom ground or a field you have harvested',
  fiber: 'fiber comes from cutting the reeds where the bank is wet',
  cloth: 'cloth is woven from fiber',
  hide: 'a hide comes off an animal you have killed',
  wood: 'wood comes from felling a tree',
  plank: 'planks are cut from wood',
  stone: 'stone comes from the loose rock at the foot of an outcrop',
  clay: 'clay comes from a bank where the ground has slumped',
}

export function shortOf(kind: string): string {
  const name = inputName(kind)
  const source = MATERIAL_SOURCE[name]
  return source === undefined ? `not enough ${name}` : `not enough ${name} — ${source}`
}

// What stands between these hands and this recipe right now, or null when nothing does.
function craftRefusal(state: WorldState, agentId: string, recipe: SeedRecipe): string | null {
  for (const [kind, qty] of Object.entries(recipe.inputs)) {
    if (heldForInput(state, agentId, kind) < qty) return shortOf(kind)
  }
  if (recipe.atFire && !keptFireInReach(state, agentId)) return 'there is no fire lit here to cook on'
  if (recipe.water !== undefined && heldWater(state, agentId) === undefined) return 'you have no water to cook with'
  return null
}

// The first road whose inputs are all in hand. Refusal comes only when no road has them, and
// it is the road that was NAMED that speaks — the same shape as the build transpose fallback.
function chosenRoute(
  state: WorldState, config: SimConfig, agentId: string, name: string,
): { recipe: SeedRecipe } | { refusal: string } {
  const routes = craftRoutes(config, name)
  // A refusal must leave a door open (addendum §9): not knowing a craft and
  // the craft not existing look the same from here, so name both ways out.
  if (routes.length === 0) {
    return { refusal: `no such recipe: ${name} — perhaps someone nearby knows how, or it wants discovering.` }
  }
  let asNamed: string | null = null
  for (const recipe of routes) {
    const refusal = craftRefusal(state, agentId, recipe)
    if (refusal === null) return { recipe }
    asNamed ??= refusal
  }
  return { refusal: asNamed! }
}

const craft: VerbDef = makeVerb({
  kind: 'craft',
  validate(state, config, agentId, params) {
    const p = CraftParams.safeParse(params)
    if (!p.success) return 'craft needs a {recipe}'
    const route = chosenRoute(state, config, agentId, p.data.recipe)
    return 'refusal' in route ? route.refusal : null
  },
  onComplete(state, config, agentId, params) {
    const p = CraftParams.parse(params)
    const route = chosenRoute(state, config, agentId, p.recipe)
    if ('refusal' in route) return []
    const recipe = route.recipe
    const events: PendingEvent[] = []
    for (const [kind, qty] of Object.entries(recipe.inputs)) {
      if (heldForInput(state, agentId, kind) < qty) return []
      events.push(...consumeForInput(state, agentId, kind, qty))
    }
    if (recipe.atFire && !keptFireInReach(state, agentId)) return []
    if (recipe.water !== undefined) {
      const vessel = heldWater(state, agentId)
      if (vessel === undefined) return []
      events.push({
        type: 'item_filled',
        payload: { itemId: vessel.id, charges: Math.max(0, (vessel.charges ?? 0) - recipe.water) },
      })
    }
    return [
      ...events,
      {
        type: 'item_spawned',
        payload: {
          id: mintId(state, 'item'), kind: recipe.output.kind, qty: recipe.output.qty,
          loc: { t: 'agent', id: agentId },
          ...ownerStamp(config, agentId), ...crafterStamp(state, config, agentId, recipe.skill),
          ...spoilageFor(state, recipe.output.kind, config),
        },
      },
      { type: 'skill_gained', payload: { agentId, track: recipe.skill, xp: 1 } },
    ]
  },
})

const extinguish: VerbDef = makeVerb({
  kind: 'extinguish',
  validate(state, _config, agentId, params) {
    const p = ExtinguishParams.safeParse(params)
    if (!p.success) return 'extinguish needs a {structureId}'
    const s = state.structures[p.data.structureId]
    if (!s) return 'no such structure'
    if (!s.burning) return 'not burning'
    if (!nearRect(state, agentId, s.x, s.y, s.w, s.h)) return 'not close enough to the fire'
    return null
  },
  onComplete(state, _config, _agentId, params) {
    const p = ExtinguishParams.parse(params)
    if (!state.structures[p.structureId]?.burning) return []
    return [{ type: 'fire_extinguished', payload: { structureId: p.structureId, cause: 'doused' } }]
  },
})

export const STONE_KIND = 'stone'
// Grass, bare earth and the dirt feet have already worn: all three take a road.
const PAVEABLE: ReadonlySet<TileId> = new Set<TileId>([0, 1, 8])

// A road is not something the map has; it is something somebody carried stone for.
const pave: VerbDef = makeVerb({
  kind: 'pave',
  duration: (_state, config) => config.roads.paveDurationTicks,
  validate(state, config, agentId, params) {
    if (!config.roads.enabled) return 'your hands find no way to lay a road here'
    const p = TileParams.safeParse(params)
    if (!p.success) return 'pave needs a tile {x, y}'
    const tile = tileAt(state, p.data.x, p.data.y)
    if (tile === null || !PAVEABLE.has(tile)) return 'nothing to pave here'
    if (!withinReach(state, agentId, p.data.x, p.data.y)) return 'not close enough to pave'
    if (heldQty(state, agentId, STONE_KIND) < config.roads.stonePerTile) return shortOf(STONE_KIND)
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = TileParams.parse(params)
    const tile = tileAt(state, p.x, p.y)
    if (tile === null || !PAVEABLE.has(tile)) return []
    if (heldQty(state, agentId, STONE_KIND) < config.roads.stonePerTile) return []
    return [
      ...consumeHeld(state, agentId, STONE_KIND, config.roads.stonePerTile),
      { type: 'tile_changed', payload: { x: p.x, y: p.y, from: tile, to: 7, reason: 'paved', byId: agentId } },
    ]
  },
  skill: { track: 'masonry', xp: 1 },
})

// A sapling is not timber yet. Clearing one costs the swing and yields nothing at all; felling
// a grown tree costs an hour's work and hands over the wood the town has otherwise only ever
// been given. Either way the ground goes back to grass, where the next seed can fall — which
// is what makes the regrowth cycle a cycle and not an ornament.
const SAPLING_TILE: TileId = 9
const FOREST_TILE: TileId = 3
export const CLEAR_TICKS = 4
export const FELL_TICKS = 30
export const TIMBER_PER_TREE = 2

const chop: VerbDef = makeVerb({
  kind: 'chop',
  duration(state, _config, _agentId, params) {
    const p = TileParams.parse(params)
    return tileAt(state, p.x, p.y) === FOREST_TILE ? FELL_TICKS : CLEAR_TICKS
  },
  validate(state, _config, agentId, params) {
    const p = TileParams.safeParse(params)
    if (!p.success) return 'chop needs a tile {x, y}'
    const tile = tileAt(state, p.data.x, p.data.y)
    if (tile !== SAPLING_TILE && tile !== FOREST_TILE) return 'there is nothing standing there to cut'
    if (!withinReach(state, agentId, p.data.x, p.data.y)) return 'not close enough to cut'
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = TileParams.parse(params)
    const tile = tileAt(state, p.x, p.y)
    if (tile !== SAPLING_TILE && tile !== FOREST_TILE) return []
    const cleared: PendingEvent = {
      type: 'tile_changed',
      payload: { x: p.x, y: p.y, from: tile, to: 0, reason: 'cleared', byId: agentId },
    }
    if (tile === SAPLING_TILE) return [cleared]
    return [cleared, {
      type: 'item_spawned',
      payload: {
        id: mintId(state, 'item'), kind: FUEL_KIND, qty: TIMBER_PER_TREE,
        loc: { t: 'agent', id: agentId }, ...ownerStamp(config, agentId),
      },
    }]
  },
  skill: { track: 'farming', xp: 1 },
})

export const DouseParams = z.object({ x: z.number().int(), y: z.number().int() }).strict()

// The burning structure whose footprint covers this tile, if one is alight there.
function burningAt(state: WorldState, x: number, y: number) {
  for (const id of Object.keys(state.structures).sort()) {
    const s = state.structures[id]!
    if (s.burning && x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) return s
  }
  return null
}

function heldBuckets(state: WorldState, agentId: string) {
  return heldStacks(state, agentId, BUCKET_KIND)
}

// One bucket, one dose, one tile of wall. Anything bigger than that is a bucket line, and a
// bucket line is a thing the town has to organise for itself.
const douse: VerbDef = makeVerb({
  kind: 'douse',
  validate(state, _config, agentId, params) {
    const p = DouseParams.safeParse(params)
    if (!p.success) return 'douse needs a tile {x, y}'
    const s = burningAt(state, p.data.x, p.data.y)
    if (!s) return 'nothing is burning there'
    if (!nearRect(state, agentId, s.x, s.y, s.w, s.h)) return 'not close enough to the fire'
    const buckets = heldBuckets(state, agentId)
    if (buckets.length === 0) return 'you have nothing to carry water in'
    if (!buckets.some((i) => (i.charges ?? 0) > 0)) return 'the bucket is empty'
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = DouseParams.parse(params)
    const s = burningAt(state, p.x, p.y)
    const bucket = heldBuckets(state, agentId).find((i) => (i.charges ?? 0) > 0)
    if (!s || bucket === undefined) return []
    return [
      { type: 'fire_extinguished', payload: { structureId: s.id, cause: 'doused', x: p.x, y: p.y, agentId } },
      { type: 'item_filled', payload: { itemId: bucket.id, charges: 0 } },
    ]
  },
})

export const SpeakParams = z.object({ text: z.string().min(1) }).strict()
export const GiveParams = z.object({ itemId: z.string(), targetId: z.string() }).strict()
export const TakeParams = z.object({ itemId: z.string() }).strict()
export const WriteParams = z.object({ itemId: z.string().optional(), text: z.string().min(1) }).strict()
export const ReadParams = z.object({ itemId: z.string() }).strict()
export const TeachParams = z.object({ targetId: z.string(), track: z.string() }).strict()
export const AttackParams = z.object({ targetId: z.string() }).strict()
export const ExperimentParams = z.object({ description: z.string() }).strict()

const speak: VerbDef = makeVerb({
  kind: 'speak',
  validate(_state, _config, _agentId, params) {
    const p = SpeakParams.safeParse(params)
    if (!p.success) return 'speak needs a {text}'
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = SpeakParams.parse(params)
    const a = state.agents[agentId]!
    return [{
      type: 'agent_spoke',
      payload: { agentId, text: p.text, x: a.x, y: a.y, ...(a.insideId === undefined ? {} : { insideId: a.insideId }) },
    }]
  },
})

const give: VerbDef = makeVerb({
  kind: 'give',
  validate(state, _config, agentId, params) {
    const p = GiveParams.safeParse(params)
    if (!p.success) return 'give needs {itemId, targetId}'
    const bad = adjacentLivingTarget(state, agentId, p.data.targetId, {
      self: 'cannot give to yourself', gone: 'no one there to receive', far: 'not adjacent to give',
    })
    if (bad) return bad
    const item = state.items[p.data.itemId]
    if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = GiveParams.parse(params)
    const item = state.items[p.itemId]
    if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId) return []
    const target = state.agents[p.targetId]
    if (!target || !target.alive) return []
    // The only voluntary transfer of title the world has.
    return [
      { type: 'item_moved', payload: { id: p.itemId, loc: { t: 'agent', id: p.targetId } } },
      ...(config.ownership.enabled
        ? [{ type: 'item_owner_changed', payload: { id: p.itemId, owner: p.targetId } }]
        : []),
    ]
  },
})

// Close enough to close a hand around. The one reach test `take` has always used, so a thing
// another verb reaches for is exactly the thing `take` would have handed it.
export function itemWithinReach(state: WorldState, agentId: string, item: Item): boolean {
  if (item.loc.t === 'agent') return false
  if (item.loc.t === 'tile') return withinReach(state, agentId, item.loc.x, item.loc.y)
  const s = state.structures[item.loc.id]
  return s !== undefined && nearRect(state, agentId, s.x, s.y, s.w, s.h)
}

// The lifting itself, so every verb that folds a taking into itself lifts the same way — the
// claim on an unowned thing, and the public record when the thing is somebody's.
function liftEvents(state: WorldState, config: SimConfig, agentId: string, itemId: string): PendingEvent[] {
  const item = state.items[itemId]
  if (!item || item.loc.t === 'agent') return []
  const moved = { type: 'item_moved', payload: { id: itemId, loc: { t: 'agent', id: agentId } } }
  if (!config.ownership.enabled || item.owner === agentId) return [moved]
  // Unowned things are claimed by the hand that lifts them; owned things are not.
  // The engine blocks nothing here — it only makes sure the taking is public.
  if (item.owner === undefined) {
    return [moved, { type: 'item_owner_changed', payload: { id: itemId, owner: agentId } }]
  }
  const s = item.loc.t === 'structure' ? state.structures[item.loc.id] : undefined
  const at = item.loc.t === 'tile' ? { x: item.loc.x, y: item.loc.y } : { x: s?.x ?? 0, y: s?.y ?? 0 }
  return [moved, {
    type: 'item_taken',
    payload: { itemId, kind: item.kind, takerId: agentId, ownerId: item.owner, x: at.x, y: at.y },
  }]
}

const take: VerbDef = makeVerb({
  kind: 'take',
  validate(state, _config, agentId, params) {
    const p = TakeParams.safeParse(params)
    if (!p.success) return 'take needs an {itemId}'
    const item = state.items[p.data.itemId]
    if (!item) return 'no such item'
    if (item.loc.t === 'agent') return item.loc.id === agentId ? 'already holding that' : 'someone is holding that'
    return itemWithinReach(state, agentId, item) ? null : 'not close enough to take'
  },
  onComplete(state, config, agentId, params) {
    return liftEvents(state, config, agentId, TakeParams.parse(params).itemId)
  },
})

export const StowParams = z.object({ itemId: z.string(), structureId: z.string() }).strict()

const stow: VerbDef = makeVerb({
  kind: 'stow',
  validate(state, _config, agentId, params) {
    const p = StowParams.safeParse(params)
    if (!p.success) return 'stow needs {itemId, structureId}'
    const item = state.items[p.data.itemId]
    if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
    const s = state.structures[p.data.structureId]
    if (!s) return 'there is nothing there to put it in'
    if (s.stage !== 'complete') return 'it is not finished'
    const a = state.agents[agentId]!
    if (a.insideId !== undefined) return a.insideId === s.id ? null : 'a wall is in the way'
    if (!nearRect(state, agentId, s.x, s.y, s.w, s.h)) return 'not close enough to put anything down there'
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = StowParams.parse(params)
    const item = state.items[p.itemId]
    if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId) return []
    // A shelf is not a transfer: the owner is unchanged, wherever the thing sits.
    return [{ type: 'item_moved', payload: { id: p.itemId, loc: { t: 'structure', id: p.structureId } } }]
  },
})

export const INSCRIPTION_MAX_CHARS = 280
export const InscribeParams = z.object({
  structureId: z.string(), text: z.string().min(1).max(INSCRIPTION_MAX_CHARS),
}).strict()

// Writing on something nobody can pocket. Three ticks, because carving is not scribbling.
const inscribe: VerbDef = makeVerb({
  kind: 'inscribe',
  validate(state, config, agentId, params) {
    if (!config.inscription.enabled) return 'your hands find no way to mark this'
    const p = InscribeParams.safeParse(params)
    if (!p.success) return `inscribe needs {structureId, text} of 1 to ${INSCRIPTION_MAX_CHARS} characters`
    const s = state.structures[p.data.structureId]
    if (!s) return 'there is nothing there to mark'
    if (s.stage !== 'complete') return 'it is not finished'
    const a = state.agents[agentId]!
    if (a.insideId !== undefined) return a.insideId === s.id ? null : 'a wall is in the way'
    if (!nearRect(state, agentId, s.x, s.y, s.w, s.h)) return 'not close enough to mark it'
    return null
  },
  duration() { return 3 },
  onComplete(state, _config, agentId, params) {
    const p = InscribeParams.parse(params)
    if (!state.structures[p.structureId]) return []
    return [{ type: 'structure_inscribed', payload: { structureId: p.structureId, text: p.text, agentId } }]
  },
})

const write: VerbDef = makeVerb({
  kind: 'write',
  validate(state, _config, agentId, params) {
    const p = WriteParams.safeParse(params)
    if (!p.success) return 'write needs {text}'
    if (p.data.itemId !== undefined) {
      const item = state.items[p.data.itemId]
      if (!item) return 'no such item'
      if (item.kind !== 'note') return 'not a note'
      if (item.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
    }
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = WriteParams.parse(params)
    if (p.itemId !== undefined) {
      const item = state.items[p.itemId]
      if (!item || item.kind !== 'note' || item.loc.t !== 'agent' || item.loc.id !== agentId) return []
      return [{ type: 'item_text_changed', payload: { id: p.itemId, text: p.text } }]
    }
    return [{ type: 'item_spawned', payload: { id: mintId(state, 'item'), kind: 'note', qty: 1, loc: { t: 'agent', id: agentId }, text: p.text, ...ownerStamp(config, agentId) } }]
  },
})

const read: VerbDef = makeVerb({
  kind: 'read',
  validate(state, _config, agentId, params) {
    const p = ReadParams.safeParse(params)
    if (!p.success) return 'read needs an {itemId}'
    const item = state.items[p.data.itemId]
    if (!item) return 'no such item'
    if (item.kind !== 'note') return 'there is nothing to read'
    if (item.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
    return null
  },
  onComplete() { return [] },
  results(state, _config, _agentId, params) {
    const p = ReadParams.parse(params)
    return { text: state.items[p.itemId]?.text ?? '' }
  },
})

const teach: VerbDef = makeVerb({
  kind: 'teach',
  validate(state, config, agentId, params) {
    const p = TeachParams.safeParse(params)
    if (!p.success) return 'teach needs {targetId, track}'
    const bad = adjacentLivingTarget(state, agentId, p.data.targetId, {
      self: 'cannot teach yourself', gone: 'no one there to teach', busy: 'they are busy', far: 'not adjacent to teach',
    })
    if (bad) return bad
    if (!config.skills.tracks.includes(p.data.track)) return `no such skill: ${p.data.track}`
    if ((state.agents[agentId]!.skills[p.data.track] ?? 0) === 0) return 'nothing to teach'
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = TeachParams.parse(params)
    const target = state.agents[p.targetId]
    if (!target || !target.alive) return []
    const teacherXp = state.agents[agentId]!.skills[p.track] ?? 0
    const grant = Math.min(teacherXp * 0.1, 50)
    return [{ type: 'skill_gained', payload: { agentId: p.targetId, track: p.track, xp: grant } }]
  },
  skill: { track: 'scholarship', xp: 1 },
})

// How deep the wound goes, as a clock the body then carries. `agent_injured` takes the hp and
// remembers the day; the affliction is what a death can be attributed to, and it is the only
// thing that carries the hand behind the blow — without it `slain` is a word DEATH_CAUSES holds
// and the world can never produce (gap found by GATE G11a).
const INJURY_SEVERITY: Readonly<Record<'minor' | 'serious' | 'grave', number>> = {
  minor: 1, serious: 2, grave: 3,
}

const attack: VerbDef = makeVerb({
  kind: 'attack',
  validate(state, _config, agentId, params) {
    const p = AttackParams.safeParse(params)
    if (!p.success) return 'attack needs a {targetId}'
    return adjacentLivingTarget(state, agentId, p.data.targetId, {
      self: 'cannot attack yourself', gone: 'no one there to attack', far: 'not adjacent to attack',
    })
  },
  onComplete(state, config, agentId, params, rng) {
    const p = AttackParams.parse(params)
    const a = state.agents[agentId]!
    const t = state.agents[p.targetId]
    if (!t || !t.alive) return []
    if (Math.abs(a.x - t.x) > 1 || Math.abs(a.y - t.y) > 1) return []
    const maxPower = 2 * config.health.maxHp
    const scoreA = rng.next() * ((a.hp + a.needs.energy) / maxPower)
    const scoreB = rng.next() * ((t.hp + t.needs.energy) / maxPower)
    const margin = Math.abs(scoreA - scoreB)
    const loserId = scoreA < scoreB ? agentId : p.targetId
    const kind = margin < 0.2 ? 'minor' : margin < 0.5 ? 'serious' : 'grave'
    const winnerId = loserId === agentId ? p.targetId : agentId
    // Three things happen when a blow lands, and each is owned by exactly one event: the hp
    // comes off through `agent_harmed`, which is the only event in the world that says a hand
    // was behind it; the wound goes on the record through `agent_injured`; and the clock that
    // can kill starts with the affliction. `agent_harmed` had no emitter at all before this,
    // so first_quarrel and first_reconciliation could never fire (C11 R16).
    return [
      { type: 'agent_harmed', payload: { agentId: loserId, amount: config.health.injuryDamage[kind], source: 'attack', byId: winnerId } },
      { type: 'agent_injured', payload: { agentId: loserId, kind } },
      {
        type: 'agent_afflicted',
        payload: { agentId: loserId, kind: 'injury', severity: INJURY_SEVERITY[kind], sourceId: winnerId },
      },
    ]
  },
  rngStream: 'combat',
})

const experiment: VerbDef = makeVerb({
  kind: 'experiment',
  validate() { return 'You lack the knowledge to attempt this. Perhaps someone in the town knows how.' },
  onComplete() { return [] },
})

export const VERBS: Record<string, VerbDef> = {
  walk, sleep, wake, enter, exit, eat, tend, till, plant, harvest, fish, forage, build, craft, extinguish,
  drink, fill, dig_channel: digChannel, douse, pave, hunt, wear, doff, kindle, snuff, stoke, chop,
  speak, give, take, stow, write, read, inscribe, teach, attack, experiment,
}

// Hot-registration seam: codified recipe verbs join the live registry by kind id.
export function registerVerb(def: VerbDef): void {
  if (VERBS[def.kind]) throw new Error(`already registered: ${def.kind}`)
  VERBS[def.kind] = def
}

export function unregisterVerb(kind: string): void {
  delete VERBS[kind]
}

// One tick of an in-progress build: the agent works, the site advances in step.
export function stepBuild(state: WorldState, agentId: string): PendingEvent[] {
  const a = state.agents[agentId]
  const act = a?.activity
  if (!a || !act || act.verb !== 'build') throw new Error(`stepBuild: agent ${agentId} has no build in progress`)
  const p = BuildParams.parse(act.params)
  // On a plot there is no coordinate to look the walls up by, so the site is the one THIS
  // agent has half-raised — which is also the honest reading of the sited case.
  const site = p.x === undefined || p.y === undefined
    ? ownSite(state, agentId, p.kind)
    : siteAt(state, p.x, p.y)
  if (!site) return [{ type: 'action_interrupted', payload: { agentId, reason: 'gone' } }]
  return [
    { type: 'action_progressed', payload: { agentId, ticks: 1 } },
    { type: 'structure_progressed', payload: { id: site.id, ticks: 1 } },
  ]
}

// One tick of an in-progress walk. Returns the events to append this tick:
// action_progressed (+ agent_moved on tile boundaries), or a lone
// action_interrupted {reason:'blocked'} if the next tile became impassable.
export function stepWalk(state: WorldState, agentId: string): PendingEvent[] {
  const a = state.agents[agentId]
  const act = a?.activity
  if (!a || !act || act.verb !== 'walk' || !act.path) throw new Error(`stepWalk: agent ${agentId} has no walk in progress`)
  const done = act.path.findIndex(([x, y]) => x === a.x && y === a.y) + 1
  const tilesLeft = act.path.length - done
  const perTile = Math.ceil(act.ticksRemaining / tilesLeft)
  if ((act.ticksRemaining - 1) % perTile !== 0) {
    return [{ type: 'action_progressed', payload: { agentId, ticks: 1 } }]
  }
  const [nx, ny] = act.path[done]!
  if (!isPassable(state, nx, ny)) {
    return [{ type: 'action_interrupted', payload: { agentId, reason: 'blocked' } }]
  }
  return [
    { type: 'action_progressed', payload: { agentId, ticks: 1 } },
    { type: 'agent_moved', payload: { id: agentId, x: nx, y: ny } },
  ]
}
