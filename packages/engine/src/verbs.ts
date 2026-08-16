import { z } from 'zod'
import { MINUTES_PER_DAY, simTimeFromTick, type SimConfig } from '@sj/shared'
import { mintId, type TileId, type WorldState } from './state.js'
import type { RngStream } from './rng.js'
import { doorTile } from './interiors.js'
import { findPath, isPassable } from './path.js'

export type PendingEvent = { type: string; payload: unknown }
export type VerbKind =
  | 'walk' | 'sleep' | 'wake' | 'enter' | 'exit' | 'eat' | 'tend' | 'till' | 'plant' | 'harvest' | 'fish' | 'forage'
  | 'build' | 'craft' | 'extinguish'
  | 'speak' | 'give' | 'take' | 'write' | 'read' | 'teach' | 'attack' | 'experiment'

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
export const FOOD_KINDS: ReadonlySet<string> = new Set([FORAGE_KIND, FISH_KIND, 'venison', 'bread', 'wheat'])

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
  onComplete(state, config, agentId, params) {
    const p = EatParams.parse(params)
    const item = state.items[p.itemId]
    if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId) return []
    return [
      { type: 'item_qty_changed', payload: { id: p.itemId, delta: -1 } },
      { type: 'need_changed', payload: { id: agentId, need: 'hunger', delta: config.needs.eatRestoreHunger } },
    ]
  },
})

export const TendParams = z.object({ targetId: z.string() }).strict()

const tend: VerbDef = makeVerb({
  kind: 'tend',
  validate(state, config, agentId, params) {
    const p = TendParams.safeParse(params)
    if (!p.success) return 'tend needs a {targetId}'
    const bad = adjacentLivingTarget(state, agentId, p.data.targetId, {
      self: 'cannot tend yourself', gone: 'no one there to tend', far: 'not adjacent to the patient',
    })
    if (bad) return bad
    const target = state.agents[p.data.targetId]!
    if (!target.ill && target.hp >= config.health.maxHp) return 'nothing to tend'
    return null
  },
  onComplete(state, _config, agentId, params) {
    const p = TendParams.parse(params)
    const target = state.agents[p.targetId]
    const a = state.agents[agentId]!
    if (!target || !target.alive) return []
    if (Math.abs(a.x - target.x) > 1 || Math.abs(a.y - target.y) > 1) return []
    return [{ type: 'agent_tended', payload: { agentId: p.targetId } }]
  },
  skill: { track: 'medicine', xp: 1 },
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
  onComplete(_state, _config, _agentId, params) {
    const p = TileParams.parse(params)
    return [{ type: 'terrain_changed', payload: { x: p.x, y: p.y, tile: 6 } }]
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
    return [
      { type: 'crop_harvested', payload: { cropId: p.cropId } },
      { type: 'item_spawned', payload: { id: mintId(state, 'item'), kind: crop.kind, qty: def.yield, loc: { t: 'agent', id: agentId } } },
    ]
  },
  skill: { track: 'farming', xp: 1 },
})

const fish: VerbDef = makeVerb({
  kind: 'fish',
  validate(state, _config, agentId, params) {
    const p = TileParams.safeParse(params)
    if (!p.success) return 'fish needs a water tile {x, y}'
    if (tileAt(state, p.data.x, p.data.y) !== 2) return 'no water there'
    if (!withinReach(state, agentId, p.data.x, p.data.y)) return 'not close enough to the water'
    return null
  },
  onComplete(state, config, agentId, _params, rng) {
    if (state.wildlife.fish <= 0) return []
    const chance = config.wildlife.fishCatchBase * (1 + skillLevel(state, agentId, 'fishing', config) / 10)
    if (rng.next() >= chance) return []
    return [
      { type: 'wildlife_changed', payload: { fish: state.wildlife.fish - 1 } },
      { type: 'item_spawned', payload: { id: mintId(state, 'item'), kind: FISH_KIND, qty: 1, loc: { t: 'agent', id: agentId } } },
    ]
  },
  skill: { track: 'fishing', xp: 1 },
  rngStream: 'wildlife',
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
      { type: 'item_spawned', payload: { id: mintId(state, 'item'), kind: FORAGE_KIND, qty, loc: { t: 'agent', id: agentId } } },
    ]
  },
  skill: { track: 'foraging', xp: 1 },
})

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

const build: VerbDef = makeVerb({
  kind: 'build',
  validate(state, config, agentId, params) {
    const p = BuildParams.safeParse(params)
    if (!p.success) return 'build needs {kind, x, y}'
    if (p.data.kind !== 'hut') return `cannot build a ${p.data.kind}`
    const { w, h } = config.construction.hutSize
    if (!nearRect(state, agentId, p.data.x, p.data.y, w, h)) return 'not close enough to build'
    const site = siteAt(state, p.data.x, p.data.y)
    if (site && site.kind === p.data.kind) return null // resume: materials already spent
    for (const s of Object.values(state.structures)) {
      if (p.data.x < s.x + s.w && s.x < p.data.x + w && p.data.y < s.y + s.h && s.y < p.data.y + h) {
        return 'that spot is taken'
      }
    }
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (!isPassable(state, p.data.x + dx, p.data.y + dy)) return 'cannot build there'
      }
    }
    for (const a of Object.values(state.agents)) {
      if (a.alive && a.x >= p.data.x && a.x < p.data.x + w && a.y >= p.data.y && a.y < p.data.y + h) {
        return 'someone is in the way'
      }
    }
    if (heldQty(state, agentId, 'wood') < config.construction.hutMaterials.wood) return 'not enough wood'
    return null
  },
  duration(state, config, _agentId, params) {
    const p = BuildParams.parse(params)
    return config.construction.hutTicks - (siteAt(state, p.x, p.y)?.progressTicks ?? 0)
  },
  onStart(state, config, agentId, params) {
    const p = BuildParams.parse(params)
    if (siteAt(state, p.x, p.y)) return []
    const { w, h } = config.construction.hutSize
    return [
      ...consumeHeld(state, agentId, 'wood', config.construction.hutMaterials.wood),
      {
        type: 'structure_planned',
        payload: {
          id: mintId(state, 'structure'), kind: p.kind, x: p.x, y: p.y, w, h,
          maxHp: config.construction.hutMaxHp, flammable: true, builderId: agentId,
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
    if (!recipe) return `no such recipe: ${p.data.recipe}`
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
        payload: { id: mintId(state, 'item'), kind: recipe.output.kind, qty: recipe.output.qty, loc: { t: 'agent', id: agentId } },
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
  onComplete(state, _config, agentId, params) {
    const p = GiveParams.parse(params)
    const item = state.items[p.itemId]
    if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId) return []
    const target = state.agents[p.targetId]
    if (!target || !target.alive) return []
    return [{ type: 'item_moved', payload: { id: p.itemId, loc: { t: 'agent', id: p.targetId } } }]
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
  onComplete(state, _config, agentId, params) {
    const p = TakeParams.parse(params)
    const item = state.items[p.itemId]
    if (!item || item.loc.t === 'agent') return []
    return [{ type: 'item_moved', payload: { id: p.itemId, loc: { t: 'agent', id: agentId } } }]
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
  onComplete(state, _config, agentId, params) {
    const p = WriteParams.parse(params)
    if (p.itemId !== undefined) {
      const item = state.items[p.itemId]
      if (!item || item.kind !== 'note' || item.loc.t !== 'agent' || item.loc.id !== agentId) return []
      return [{ type: 'item_text_changed', payload: { id: p.itemId, text: p.text } }]
    }
    return [{ type: 'item_spawned', payload: { id: mintId(state, 'item'), kind: 'note', qty: 1, loc: { t: 'agent', id: agentId }, text: p.text } }]
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
  validate() { return 'You lack the knowledge to attempt this.' },
  onComplete() { return [] },
})

export const VERBS: Record<string, VerbDef> = {
  walk, sleep, wake, enter, exit, eat, tend, till, plant, harvest, fish, forage, build, craft, extinguish,
  speak, give, take, write, read, teach, attack, experiment,
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
