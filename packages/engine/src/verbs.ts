import { z } from 'zod'
import { MINUTES_PER_DAY, simTimeFromTick, type SimConfig } from '@sj/shared'
import { mintId, type TileId, type WorldState } from './state.js'
import type { RngStream } from './rng.js'
import { findPath, isPassable } from './path.js'

export type PendingEvent = { type: string; payload: unknown }
export type VerbKind =
  | 'walk' | 'sleep' | 'wake' | 'eat' | 'tend' | 'till' | 'plant' | 'harvest' | 'fish' | 'forage'
  | 'build' | 'craft' | 'extinguish'

export type VerbDef = {
  kind: VerbKind
  validate(state: WorldState, config: SimConfig, agentId: string, params: Record<string, unknown>): string | null
  duration(state: WorldState, config: SimConfig, agentId: string, params: Record<string, unknown>): number
  onStart?(state: WorldState, config: SimConfig, agentId: string, params: Record<string, unknown>): PendingEvent[]
  onComplete(state: WorldState, config: SimConfig, agentId: string, params: Record<string, unknown>, rng: RngStream): PendingEvent[]
  interruptible: boolean
  skill?: { track: string; xp: number }
  rngStream?: string
}

export const WalkParams = z.object({ x: z.number().int(), y: z.number().int() }).strict()

export function ticksPerTile(state: WorldState, config: SimConfig, agentId: string): number {
  const a = state.agents[agentId]!
  const debuffed = Object.values(a.needs).some((v) => v < config.needs.debuffThreshold)
  return debuffed ? config.movement.debuffTicksPerTile : config.movement.baseTicksPerTile
}

const walk: VerbDef = {
  kind: 'walk',
  validate(state, _config, agentId, params) {
    const p = WalkParams.safeParse(params)
    if (!p.success) return 'walk needs a destination {x, y}'
    const a = state.agents[agentId]!
    if (a.x === p.data.x && a.y === p.data.y) return 'already at that spot'
    if (findPath(state, a, p.data) === null) return 'no path to that spot'
    return null
  },
  duration(state, config, agentId, params) {
    const p = WalkParams.parse(params)
    const a = state.agents[agentId]!
    const path = findPath(state, a, p)
    if (!path) throw new Error(`walk.duration: no path for ${agentId}`)
    return path.length * ticksPerTile(state, config, agentId)
  },
  onComplete() { return [] },
  interruptible: true,
}

export const EatParams = z.object({ itemId: z.string() }).strict()

// Single food registry: eat validates against it, forage/fish/harvest spawn from it.
export const FORAGE_KIND = 'berries'
export const FISH_KIND = 'fish'
export const FOOD_KINDS: ReadonlySet<string> = new Set([FORAGE_KIND, FISH_KIND, 'venison', 'bread', 'wheat'])

const sleep: VerbDef = {
  kind: 'sleep',
  validate(state, _config, agentId) {
    return state.agents[agentId]!.asleep ? 'already asleep' : null
  },
  duration() { return 1 },
  onComplete(_state, _config, agentId) { return [{ type: 'agent_slept', payload: { agentId } }] },
  interruptible: true,
}

// submitIntent already prepends agent_woke for any intent from a sleeper.
const wake: VerbDef = {
  kind: 'wake',
  validate(state, _config, agentId) {
    return state.agents[agentId]!.asleep ? null : 'not asleep'
  },
  duration() { return 1 },
  onComplete() { return [] },
  interruptible: true,
}

const eat: VerbDef = {
  kind: 'eat',
  validate(state, _config, agentId, params) {
    const p = EatParams.safeParse(params)
    if (!p.success) return 'eat needs an {itemId}'
    const item = state.items[p.data.itemId]
    if (!item || item.loc.t !== 'agent' || item.loc.id !== agentId) return 'not holding that'
    if (!FOOD_KINDS.has(item.kind)) return `${item.kind} is not food`
    return null
  },
  duration() { return 1 },
  onComplete(_state, config, agentId, params) {
    const p = EatParams.parse(params)
    return [
      { type: 'item_qty_changed', payload: { id: p.itemId, delta: -1 } },
      { type: 'need_changed', payload: { id: agentId, need: 'hunger', delta: config.needs.eatRestoreHunger } },
    ]
  },
  interruptible: true,
}

export const TendParams = z.object({ targetId: z.string() }).strict()

const tend: VerbDef = {
  kind: 'tend',
  validate(state, config, agentId, params) {
    const p = TendParams.safeParse(params)
    if (!p.success) return 'tend needs a {targetId}'
    if (p.data.targetId === agentId) return 'cannot tend yourself'
    const target = state.agents[p.data.targetId]
    if (!target || !target.alive) return 'no one there to tend'
    const a = state.agents[agentId]!
    if (Math.abs(a.x - target.x) > 1 || Math.abs(a.y - target.y) > 1) return 'not adjacent to the patient'
    if (!target.ill && target.hp >= config.health.maxHp) return 'nothing to tend'
    return null
  },
  duration() { return 1 },
  onComplete(_state, _config, _agentId, params) {
    const p = TendParams.parse(params)
    return [{ type: 'agent_tended', payload: { agentId: p.targetId } }]
  },
  interruptible: true,
  skill: { track: 'medicine', xp: 1 },
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

function skillLevel(state: WorldState, agentId: string, track: string, config: SimConfig): number {
  const xp = state.agents[agentId]!.skills[track] ?? 0
  return Math.min(config.skills.maxLevel, Math.floor(xp / config.skills.xpLevelDivisor))
}

const till: VerbDef = {
  kind: 'till',
  validate(state, _config, agentId, params) {
    const p = TileParams.safeParse(params)
    if (!p.success) return 'till needs a tile {x, y}'
    const tile = tileAt(state, p.data.x, p.data.y)
    if (tile !== 0 && tile !== 1) return 'only grass or dirt can be tilled'
    if (!withinReach(state, agentId, p.data.x, p.data.y)) return 'not close enough to till'
    return null
  },
  duration() { return 1 },
  onComplete(_state, _config, _agentId, params) {
    const p = TileParams.parse(params)
    return [{ type: 'terrain_changed', payload: { x: p.x, y: p.y, tile: 6 } }]
  },
  interruptible: true,
  skill: { track: 'farming', xp: 1 },
}

const plant: VerbDef = {
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
  duration() { return 1 },
  onComplete(state, _config, _agentId, params) {
    const p = PlantParams.parse(params)
    const plantedDay = Math.floor(state.tick / MINUTES_PER_DAY)
    return [{ type: 'crop_planted', payload: { id: mintId(state, 'crop'), kind: p.kind, x: p.x, y: p.y, plantedDay } }]
  },
  interruptible: true,
  skill: { track: 'farming', xp: 1 },
}

const harvest: VerbDef = {
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
  duration() { return 1 },
  onComplete(state, config, agentId, params) {
    const p = HarvestParams.parse(params)
    const crop = state.crops[p.cropId]!
    const def = config.crops[crop.kind]!
    return [
      { type: 'crop_harvested', payload: { cropId: p.cropId } },
      { type: 'item_spawned', payload: { id: mintId(state, 'item'), kind: crop.kind, qty: def.yield, loc: { t: 'agent', id: agentId } } },
    ]
  },
  interruptible: true,
  skill: { track: 'farming', xp: 1 },
}

const fish: VerbDef = {
  kind: 'fish',
  validate(state, _config, agentId, params) {
    const p = TileParams.safeParse(params)
    if (!p.success) return 'fish needs a water tile {x, y}'
    if (tileAt(state, p.data.x, p.data.y) !== 2) return 'no water there'
    if (!withinReach(state, agentId, p.data.x, p.data.y)) return 'not close enough to the water'
    return null
  },
  duration() { return 1 },
  onComplete(state, config, agentId, _params, rng) {
    if (state.wildlife.fish <= 0) return []
    const chance = config.wildlife.fishCatchBase * (1 + skillLevel(state, agentId, 'fishing', config) / 10)
    if (rng.next() >= chance) return []
    return [
      { type: 'wildlife_changed', payload: { fish: state.wildlife.fish - 1 } },
      { type: 'item_spawned', payload: { id: mintId(state, 'item'), kind: FISH_KIND, qty: 1, loc: { t: 'agent', id: agentId } } },
    ]
  },
  interruptible: true,
  skill: { track: 'fishing', xp: 1 },
  rngStream: 'wildlife',
}

const forage: VerbDef = {
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
  duration() { return 1 },
  onComplete(state, config, agentId) {
    const { season } = simTimeFromTick(state.tick)
    const qty = config.wildlife.forageYieldBySeason[season]
    if (qty <= 0) return []
    return [
      { type: 'item_spawned', payload: { id: mintId(state, 'item'), kind: FORAGE_KIND, qty, loc: { t: 'agent', id: agentId } } },
    ]
  },
  interruptible: true,
  skill: { track: 'foraging', xp: 1 },
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
  return a.x >= x - 1 && a.x <= x + w && a.y >= y - 1 && a.y <= y + h
}

// The in-progress construction site at exactly (x, y), if any.
function siteAt(state: WorldState, x: number, y: number) {
  for (const id of Object.keys(state.structures).sort()) {
    const s = state.structures[id]!
    if (s.x === x && s.y === y && s.stage === 'construction') return s
  }
  return null
}

const build: VerbDef = {
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
        },
      },
    ]
  },
  onComplete(state, _config, _agentId, params) {
    const p = BuildParams.parse(params)
    const site = siteAt(state, p.x, p.y)
    return site ? [{ type: 'structure_completed', payload: { id: site.id } }] : []
  },
  interruptible: true,
  skill: { track: 'carpentry', xp: 1 },
}

const craft: VerbDef = {
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
  duration() { return 1 },
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
  interruptible: true,
}

const extinguish: VerbDef = {
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
  duration() { return 1 },
  onComplete(state, _config, _agentId, params) {
    const p = ExtinguishParams.parse(params)
    if (!state.structures[p.structureId]?.burning) return []
    return [{ type: 'fire_extinguished', payload: { structureId: p.structureId, cause: 'doused' } }]
  },
  interruptible: true,
}

export const VERBS: Record<string, VerbDef> = {
  walk, sleep, wake, eat, tend, till, plant, harvest, fish, forage, build, craft, extinguish,
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
