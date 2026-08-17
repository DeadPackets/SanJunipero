import { z } from 'zod'
import { fertilityAt, MINUTES_PER_DAY, simTimeFromTick, WATER_TILES, type SimConfig, type StructureRecipeDef } from '@sj/shared'
import { mintId, type Affliction, type TileId, type WorldState } from './state.js'
import type { RngStream } from './rng.js'
import { doorTile, sameInterior } from './interiors.js'
import { bridgeAt, BRIDGE_KIND, findPath, isPassable } from './path.js'
import { isSpoiling, spoilageFor } from './systems/spoilage.js'
import { fleeTo } from './systems/fauna.js'
import { FAUNA_YIELD, type FaunaKind } from './data/faunaDefs.js'

export type PendingEvent = { type: string; payload: unknown }
export type VerbKind =
  | 'walk' | 'sleep' | 'wake' | 'enter' | 'exit' | 'eat' | 'tend' | 'till' | 'plant' | 'harvest' | 'fish' | 'forage'
  | 'build' | 'craft' | 'extinguish' | 'drink' | 'fill' | 'hunt'
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
  if (Math.abs(a.x - target.x) > 1 || Math.abs(a.y - target.y) > 1) return reasons.far
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

export const EatParams = z.object({ itemId: z.string() }).strict()

// Single food registry: eat validates against it, forage/fish/harvest spawn from it.
export const FORAGE_KIND = 'berries'
export const FISH_KIND = 'fish'
// Edible, and that is the point: the town has to learn which mushroom is which.
export const PALE_MUSHROOM = 'pale_mushroom'
export const HERB_KIND = 'herb'
export const FOOD_KINDS: ReadonlySet<string> = new Set([
  FORAGE_KIND, FISH_KIND, 'venison', 'bread', 'wheat', PALE_MUSHROOM, HERB_KIND,
])

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

const sleep: VerbDef = makeVerb({
  kind: 'sleep',
  validate(state, config, agentId) {
    const a = state.agents[agentId]!
    if (a.asleep) return 'already asleep'
    // A body that has already gone down does not get to pick its bed.
    if (!config.structures.sleepIndoorsOnly || a.collapsedSinceTick !== null) return null
    const s = a.insideId === undefined ? undefined : state.structures[a.insideId]
    if (!s || s.stage !== 'complete' || !config.structures.sleepableKinds.includes(s.kind)) {
      return 'there is no bed here; find somewhere to lie down'
    }
    return null
  },
  onComplete(_state, _config, agentId) { return [{ type: 'agent_slept', payload: { agentId } }] },
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

const eat: VerbDef = makeVerb({
  kind: 'eat',
  validate(state, config, agentId, params) {
    const p = EatParams.safeParse(params)
    if (!p.success) return 'eat needs an {itemId}'
    const item = state.items[p.data.itemId]
    if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
    if (!isFoodKind(config, item.kind)) return `${item.kind} is not food`
    return null
  },
  rngStream: 'illness',
  onComplete(state, config, agentId, params, rng) {
    const p = EatParams.parse(params)
    const item = state.items[p.itemId]
    if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId) return []
    // A pale mushroom is always a gamble; anything else only on its last day. The roll is
    // drawn once, here at emission, and never when the meal is safe — a fresh loaf must not
    // move the stream, or two worlds that ate differently would diverge for no reason.
    const risky = config.mortality.enabled
      && (item.kind === PALE_MUSHROOM || isSpoiling(state, item, config))
      && rng.next() < config.mortality.poisonChanceSpoiled
    return [
      ...(risky
        ? [{ type: 'agent_afflicted', payload: { agentId, kind: 'poison', severity: 1, itemId: p.itemId } }]
        : []),
      ...(item.kind === HERB_KIND ? relieveWorst(state, agentId, config.mortality.herbRelief) : []),
      { type: 'item_qty_changed', payload: { id: p.itemId, delta: -1 } },
      { type: 'need_changed', payload: { id: agentId, need: 'hunger', delta: config.needs.eatRestoreHunger } },
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

// Not a dial. `RecipeSchema` has no weapon column and `SimConfigSchema` is closed after Task 2
// (G6), so the list of things that can take an animal lives here until a schema task reopens it.
export const WEAPON_KINDS: ReadonlySet<string> = new Set(['knife'])
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
  validate(state, _config, agentId, params) {
    const p = HuntParams.safeParse(params)
    if (!p.success) return 'hunt needs a {faunaId}'
    const f = state.fauna?.[p.data.faunaId]
    if (!f || !f.alive) return 'nothing there to hunt'
    if (!HUNTABLE_KINDS.has(f.kind)) return 'that is not something you can run down'
    const a = state.agents[agentId]!
    if (Math.max(Math.abs(a.x - f.x), Math.abs(a.y - f.y)) > 1) return 'too far off to reach'
    if (!Object.values(state.items).some(
      (i) => WEAPON_KINDS.has(i.kind) && i.loc.t === 'agent' && i.loc.id === agentId,
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

const forage: VerbDef = makeVerb({
  kind: 'forage',
  validate(state, _config, agentId) {
    const a = state.agents[agentId]!
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (tileAt(state, a.x + dx, a.y + dy) === 3) return null
      }
    }
    return 'no forest nearby'
  },
  onComplete(state, config, agentId) {
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

export const BuildParams = z.object({ kind: z.string(), x: z.number().int(), y: z.number().int() }).strict()
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

// The hut keeps its C9 dial as the duration source; every other kind reads its row. The two
// are asserted equal in config.test.ts, so this is one number under two names, not two numbers.
export function buildTicks(config: SimConfig, kind: string): number {
  return kind === 'hut' ? config.construction.hutTicks : (config.structures.recipes[kind]?.durationTicks ?? 0)
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

const build: VerbDef = makeVerb({
  kind: 'build',
  validate(state, config, agentId, params) {
    const p = BuildParams.safeParse(params)
    if (!p.success) return 'build needs {kind, x, y}'
    const recipe = buildableRecipe(config, p.data.kind)
    if (recipe === null) return `cannot build a ${p.data.kind}`
    const { w, h } = recipe
    if (!nearRect(state, agentId, p.data.x, p.data.y, w, h)) return 'not close enough to build'
    const site = siteAt(state, p.data.x, p.data.y)
    if (site && site.kind === p.data.kind) return null // resume: materials already spent
    for (const s of Object.values(state.structures)) {
      if (p.data.x < s.x + s.w && s.x < p.data.x + w && p.data.y < s.y + s.h && s.y < p.data.y + h) {
        return 'that spot is taken'
      }
    }
    const ground = p.data.kind === BRIDGE_KIND
      ? bridgeSiteRefusal(state, p.data.x, p.data.y, w, h)
      : buildableGroundRefusal(state, p.data.x, p.data.y, w, h)
    if (ground) return ground
    for (const a of Object.values(state.agents)) {
      if (a.alive && a.x >= p.data.x && a.x < p.data.x + w && a.y >= p.data.y && a.y < p.data.y + h) {
        return 'someone is in the way'
      }
    }
    for (const [kind, qty] of Object.entries(recipe.inputs)) {
      if (heldQty(state, agentId, kind) < qty) return `not enough ${kind}`
    }
    return null
  },
  duration(state, config, _agentId, params) {
    const p = BuildParams.parse(params)
    return buildTicks(config, p.kind) - (siteAt(state, p.x, p.y)?.progressTicks ?? 0)
  },
  onStart(state, config, agentId, params) {
    const p = BuildParams.parse(params)
    if (siteAt(state, p.x, p.y)) return []
    const recipe = buildableRecipe(config, p.kind)
    if (recipe === null) return []
    return [
      ...Object.entries(recipe.inputs).flatMap(([kind, qty]) => consumeHeld(state, agentId, kind, qty)),
      {
        type: 'structure_planned',
        payload: {
          id: mintId(state, 'structure'), kind: p.kind, x: p.x, y: p.y, w: recipe.w, h: recipe.h,
          maxHp: recipe.maxHp, flammable: recipe.flammable, builderId: agentId,
          ...(config.ownership.enabled ? { owner: agentId } : {}),
        },
      },
    ]
  },
  onComplete(state, _config, _agentId, params) {
    const p = BuildParams.parse(params)
    const site = siteAt(state, p.x, p.y)
    return site ? [{ type: 'structure_completed', payload: { id: site.id } }] : []
  },
  skill: { track: 'carpentry', xp: 1 },
})

const craft: VerbDef = makeVerb({
  kind: 'craft',
  validate(state, config, agentId, params) {
    const p = CraftParams.safeParse(params)
    if (!p.success) return 'craft needs a {recipe}'
    const recipe = config.crafting.recipes[p.data.recipe]
    // A refusal must leave a door open (addendum §9): not knowing a craft and
    // the craft not existing look the same from here, so name both ways out.
    if (!recipe) return `no such recipe: ${p.data.recipe} — perhaps someone nearby knows how, or it wants discovering.`
    for (const [kind, qty] of Object.entries(recipe.inputs)) {
      if (heldQty(state, agentId, kind) < qty) return `not enough ${kind}`
    }
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = CraftParams.parse(params)
    const recipe = config.crafting.recipes[p.recipe]!
    const events: PendingEvent[] = []
    for (const [kind, qty] of Object.entries(recipe.inputs)) {
      if (heldQty(state, agentId, kind) < qty) return []
      events.push(...consumeHeld(state, agentId, kind, qty))
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
    if (heldQty(state, agentId, STONE_KIND) < config.roads.stonePerTile) return 'not enough stone'
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

const take: VerbDef = makeVerb({
  kind: 'take',
  validate(state, _config, agentId, params) {
    const p = TakeParams.safeParse(params)
    if (!p.success) return 'take needs an {itemId}'
    const item = state.items[p.data.itemId]
    if (!item) return 'no such item'
    if (item.loc.t === 'agent') return item.loc.id === agentId ? 'already holding that' : 'someone is holding that'
    if (item.loc.t === 'tile') {
      if (!withinReach(state, agentId, item.loc.x, item.loc.y)) return 'not close enough to take'
    } else {
      const s = state.structures[item.loc.id]
      if (!s || !nearRect(state, agentId, s.x, s.y, s.w, s.h)) return 'not close enough to take'
    }
    return null
  },
  onComplete(state, config, agentId, params) {
    const p = TakeParams.parse(params)
    const item = state.items[p.itemId]
    if (!item || item.loc.t === 'agent') return []
    const moved = { type: 'item_moved', payload: { id: p.itemId, loc: { t: 'agent', id: agentId } } }
    if (!config.ownership.enabled || item.owner === agentId) return [moved]
    // Unowned things are claimed by the hand that lifts them; owned things are not.
    // The engine blocks nothing here — it only makes sure the taking is public.
    if (item.owner === undefined) {
      return [moved, { type: 'item_owner_changed', payload: { id: p.itemId, owner: agentId } }]
    }
    const s = item.loc.t === 'structure' ? state.structures[item.loc.id] : undefined
    const at = item.loc.t === 'tile' ? { x: item.loc.x, y: item.loc.y } : { x: s?.x ?? 0, y: s?.y ?? 0 }
    return [moved, {
      type: 'item_taken',
      payload: { itemId: p.itemId, kind: item.kind, takerId: agentId, ownerId: item.owner, x: at.x, y: at.y },
    }]
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
    return [{ type: 'agent_injured', payload: { agentId: loserId, kind } }]
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
  drink, fill, dig_channel: digChannel, douse, pave, hunt,
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
  const site = siteAt(state, p.x, p.y)
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
