import { isRoofedKind, type SimConfig } from '@sj/shared'
import { composePerception, type PerceptionPacket } from './perception.js'
import { doorTile } from './interiors.js'
import { submitIntent } from './intent.js'
import { FOOD_KINDS, isAdjacentToRect, isFoodKind } from './verbs/index.js'
import { createWorldTick } from './worldTick.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { RngStreams } from './rng.js'
import { EventStore } from './eventStore.js'
import { TickLoop } from './tickLoop.js'
import { openDb } from './db.js'

// Deterministic scripted policies: pure functions of perception, no Math.random and no hidden
// closure state — everything a policy decides is derivable from the packet.

export type ScriptedIntent = { verb: string; params: Record<string, unknown> }
export type Policy = (p: PerceptionPacket) => ScriptedIntent | null

export const FARMER = 'farmer'
export const FISHER = 'fisher'
export const IDLER = 'idler'
export const BUILDER = 'builder'
export const THIEF = 'thief'
export const KEEPER = 'keeper'
export const ACTORS = [FARMER, FISHER, IDLER, BUILDER, THIEF, KEEPER] as const

// Fixture geometry (64x64): river on the west edge, forest on the east edge.
export const MAP_W = 64
export const MAP_H = 64
export const FARM_PLOT = { x: 26, y: 20 }
export const HOUSE_SITE = { x: 30, y: 20 } // 2x2 footprint
export const HOUSE_WORK = { x: 30, y: 22 } // adjacent, outside footprint
export const STOREHOUSE = { id: 'structure_1', x: 20, y: 20, w: 2, h: 2 }
export const SHED = { id: 'structure_2', x: 22, y: 20, w: 1, h: 1 }
export const STOREHOUSE_NEAR = { x: 22, y: 21 } // passable tile adjacent to storehouse
export const WOOD_ITEM = 'item_1'
export const WHEAT_FARMER = 'item_2'
export const WHEAT_BUILDER = 'item_3'
export const FISHER_WATER = { x: 3, y: 32 }

// ------------------------------------------------------- the scripted theft
// The knife's id ends in no number on purpose: the counter law only rises on a numeric suffix.
export const STOLEN_ITEM = 'item_knife'
export const THIEF_POST = { x: 19, y: 20 } // beside the storehouse, on the far side from the traffic
// Six tiles from (20, 20), the corner a taking out of the storehouse is logged at. Night
// vision reaches four; noon reaches twelve. The post is the whole experiment.
export const WATCH_POST = { x: 20, y: 26 }
export const NIGHT_THEFT_TICK = 2760 // day 2, 22:00 — no moon, no torch
export const NOON_THEFT_TICK = 3600 // day 3, 12:00 — the same act, in full light
const RESTOW_TICK = 3000 // the knife goes back on the shelf between the two
const UPKEEP_EVERY = 720 // see keepUpright

export function makeFixtureMap(): TileId[][] {
  const rows: TileId[][] = []
  for (let y = 0; y < MAP_H; y++) {
    const row: TileId[] = []
    for (let x = 0; x < MAP_W; x++) {
      if (x <= 3)
        row.push(2) // river
      else if (x >= 61)
        row.push(3) // forest edge
      else row.push(0) // grass
    }
    rows.push(row)
  }
  return rows
}

const cheb = (ax: number, ay: number, bx: number, by: number): number =>
  Math.max(Math.abs(ax - bx), Math.abs(ay - by))

const held = (p: PerceptionPacket, kind: string): number =>
  p.self.inventory.filter((i) => i.kind === kind).reduce((s, i) => s + i.qty, 0)

const nearStorehouse = (p: PerceptionPacket): boolean =>
  isAdjacentToRect(p.self.x, p.self.y, STOREHOUSE)

const nearHouseSite = (p: PerceptionPacket): boolean =>
  isAdjacentToRect(p.self.x, p.self.y, { ...HOUSE_SITE, w: 2, h: 2 })

// Farmer: till + plant wheat on day 1, then eat wheat from the storehouse and sleep.
export function makeFarmerPolicy(config: SimConfig): Policy {
  return (p) => {
    const needs = p.self.body.needs
    const hasCrop = p.visible.crops.some(
      (c) => c.x === FARM_PLOT.x && c.y === FARM_PLOT.y && !c.withered,
    )

    if (!hasCrop) {
      if (cheb(p.self.x, p.self.y, FARM_PLOT.x, FARM_PLOT.y) > 1) {
        return { verb: 'walk', params: { x: FARM_PLOT.x, y: FARM_PLOT.y } }
      }
      if (p.time.tick === 1) return { verb: 'till', params: { x: FARM_PLOT.x, y: FARM_PLOT.y } }
      return { verb: 'plant', params: { x: FARM_PLOT.x, y: FARM_PLOT.y, kind: 'wheat' } }
    }

    if (needs.hunger < 60) {
      const food = p.self.inventory.find((i) => isFoodKind(config, i.kind))
      if (food) return { verb: 'eat', params: { itemId: food.id } }
      if (nearStorehouse(p)) return { verb: 'take', params: { itemId: WHEAT_FARMER } }
      return { verb: 'walk', params: { x: STOREHOUSE_NEAR.x, y: STOREHOUSE_NEAR.y } }
    }
    return { verb: 'sleep', params: {} }
  }
}

// Fisher: fish, eat, give surplus to a collapsed adjacent Idler, sleep.
export function makeFisherPolicy(config: SimConfig): Policy {
  return (p) => {
    const needs = p.self.body.needs
    const fish = p.self.inventory.filter((i) => i.kind === 'fish')
    const idler = p.visible.agents.find((a) => a.id === IDLER)

    if (needs.hunger < 60) {
      const food = p.self.inventory.find((i) => isFoodKind(config, i.kind))
      if (food) return { verb: 'eat', params: { itemId: food.id } }
    }
    if (needs.energy < 20) return { verb: 'sleep', params: {} }
    if (
      idler &&
      idler.collapsed &&
      cheb(p.self.x, p.self.y, idler.x, idler.y) <= 1 &&
      fish.length >= 2
    ) {
      return { verb: 'give', params: { itemId: fish[0]!.id, targetId: IDLER } }
    }
    if (fish.length < 2) return { verb: 'fish', params: { x: FISHER_WATER.x, y: FISHER_WATER.y } }
    return { verb: 'sleep', params: {} }
  }
}

// Idler: wander or sleep. Starts hungry (scripted), collapses, is rescued, and later starves.
export function makeIdlerPolicy(): Policy {
  const a = { x: 30, y: 30 }
  const b = { x: 5, y: 32 }
  return (p) => {
    const needs = p.self.body.needs
    const food = p.self.inventory.find((i) => FOOD_KINDS.has(i.kind))
    if (food) return { verb: 'eat', params: { itemId: food.id } }
    if (needs.energy < 20) return { verb: 'sleep', params: {} }
    const dest = p.self.x === a.x && p.self.y === a.y ? b : a
    return { verb: 'walk', params: { x: dest.x, y: dest.y } }
  }
}

// Builder: provision wood + wheat from the storehouse, build the house (with rest breaks),
// then sleep only.
export function makeBuilderPolicy(config: SimConfig): Policy {
  return (p) => {
    const needs = p.self.body.needs
    const wood = held(p, 'wood')
    const wheat = held(p, 'wheat')
    const food = p.self.inventory.find((i) => isFoodKind(config, i.kind))
    const house = p.visible.structures.find((s) => s.kind === 'house')

    if (house?.stage === 'complete') return { verb: 'sleep', params: {} }

    if (needs.hunger < 60 && food) return { verb: 'eat', params: { itemId: food.id } }

    // Wood is spent once, at the first build; only provision before the site exists.
    if (!house && (wood < config.construction.houseMaterials.wood || wheat < 1)) {
      if (nearStorehouse(p)) {
        if (wood < config.construction.houseMaterials.wood)
          return { verb: 'take', params: { itemId: WOOD_ITEM } }
        return { verb: 'take', params: { itemId: WHEAT_BUILDER } }
      }
      return { verb: 'walk', params: { x: STOREHOUSE_NEAR.x, y: STOREHOUSE_NEAR.y } }
    }

    if (!nearHouseSite(p)) return { verb: 'walk', params: { x: HOUSE_WORK.x, y: HOUSE_WORK.y } }
    return { verb: 'build', params: { kind: 'house', x: HOUSE_SITE.x, y: HOUSE_SITE.y } }
  }
}

// Keeper: owns the knife on the storehouse shelf and stands his post for three days. He does
// nothing on purpose — a body that walks about would change what is six tiles from the taking.
export function makeKeeperPolicy(): Policy {
  return () => null
}

// Thief: stands beside the storehouse and reaches in twice, at two named ticks. Carries no
// flame, which is the other half of the night rule — a lit body is a witnessed body.
export function makeThiefPolicy(): Policy {
  return (p) =>
    p.time.tick === NIGHT_THEFT_TICK || p.time.tick === NOON_THEFT_TICK
      ? { verb: 'take', params: { itemId: STOLEN_ITEM } }
      : null
}

export function makePolicies(config: SimConfig): Record<string, Policy> {
  return {
    [FARMER]: makeFarmerPolicy(config),
    [FISHER]: makeFisherPolicy(config),
    [IDLER]: makeIdlerPolicy(),
    [BUILDER]: makeBuilderPolicy(config),
    [THIEF]: makeThiefPolicy(),
    [KEEPER]: makeKeeperPolicy(),
  }
}

// One-shot scripted injections keyed on absolute tick (setup + the day-2 fire).
function scriptedTimeline(
  config: SimConfig,
  tick: number,
  emit: (type: string, payload: unknown) => void,
): void {
  // Sexes ride the reproduction flag: a fixture with it off spawns the earlier bodies exactly.
  const sex = (s: 'f' | 'm'): { sex?: 'f' | 'm' } => (config.reproduction.enabled ? { sex: s } : {})
  if (tick === 1) {
    emit('agent_spawned', { id: FARMER, name: 'Farmer', x: 26, y: 21, ageDays: 7300, ...sex('f') })
    emit('agent_spawned', { id: FISHER, name: 'Fisher', x: 4, y: 32, ageDays: 7300, ...sex('m') })
    emit('agent_spawned', { id: IDLER, name: 'Idler', x: 5, y: 32, ageDays: 7300, ...sex('m') })
    emit('agent_spawned', {
      id: BUILDER,
      name: 'Builder',
      x: 30,
      y: 22,
      ageDays: 7300,
      ...sex('f'),
    })
    emit('structure_planned', {
      id: STOREHOUSE.id,
      kind: 'storehouse',
      x: STOREHOUSE.x,
      y: STOREHOUSE.y,
      w: STOREHOUSE.w,
      h: STOREHOUSE.h,
      maxHp: 20,
      flammable: true,
      builderId: 'script',
    })
    emit('structure_planned', {
      id: SHED.id,
      kind: 'shed',
      x: SHED.x,
      y: SHED.y,
      w: SHED.w,
      h: SHED.h,
      maxHp: 20,
      flammable: true,
      builderId: 'script',
    })
    emit('item_spawned', {
      id: WOOD_ITEM,
      kind: 'wood',
      qty: 12,
      loc: { t: 'structure', id: STOREHOUSE.id },
    })
    emit('item_spawned', {
      id: WHEAT_FARMER,
      kind: 'wheat',
      qty: 3,
      loc: { t: 'structure', id: STOREHOUSE.id },
    })
    emit('item_spawned', {
      id: WHEAT_BUILDER,
      kind: 'wheat',
      qty: 3,
      loc: { t: 'structure', id: STOREHOUSE.id },
    })
    // Idler starts food-insecure: hunger 100 -> 4, collapses this tick.
    emit('needs_changed', { id: IDLER, changes: [{ need: 'hunger', delta: -96 }] })
  }
  // Day 2 (tick 1440 is the first tick of day index 1): ignite the storehouse, let it
  // spread to the adjacent shed, then scripted rain douses both.
  if (tick === 1441) emit('fire_ignited', { structureId: STOREHOUSE.id, cause: 'scripted' })
  if (tick === 1443) emit('fire_spread', { fromId: STOREHOUSE.id, toId: SHED.id })
  if (tick === 1445) emit('weather_changed', { kind: 'rain', temperatureC: 10 })

  // The theft rides the witness flag the way the sexes ride the reproduction flag: a fixture
  // with §19 off runs the earlier timeline body for body and event for event.
  if (!config.nightWitness.enabled) return
  if (tick === 1) {
    emit('agent_spawned', {
      id: THIEF,
      name: 'Thief',
      x: THIEF_POST.x,
      y: THIEF_POST.y,
      ageDays: 7300,
      ...sex('m'),
    })
    emit('agent_spawned', {
      id: KEEPER,
      name: 'Keeper',
      x: WATCH_POST.x,
      y: WATCH_POST.y,
      ageDays: 7300,
      ...sex('f'),
    })
    emit('item_spawned', {
      id: STOLEN_ITEM,
      kind: 'knife',
      qty: 1,
      loc: { t: 'structure', id: STOREHOUSE.id },
      owner: KEEPER,
    })
  }
  // The knife goes back on the shelf, so the noon taking is the same act as the night one and
  // the light is the only thing that changed.
  if (tick === RESTOW_TICK)
    emit('item_moved', { id: STOLEN_ITEM, loc: { t: 'structure', id: STOREHOUSE.id } })
  // These two are placed, not lived: a body that only stands runs out before the second night,
  // so twice a day the fixture puts them back on their feet, on a fixed clock so replay agrees.
  if (tick % UPKEEP_EVERY === 0) {
    for (const id of [THIEF, KEEPER]) {
      emit('needs_changed', {
        id,
        changes: [
          { need: 'energy', delta: 100 },
          { need: 'hunger', delta: 100 },
        ],
      })
    }
  }
}

// A policy sees only a packet, which never says "you are indoors", so the harness steps an actor
// through a doorway it is already standing in before it lies down. No commuting: rough is the law.
function bedGate(
  state: WorldState,
  config: SimConfig,
  id: string,
  intent: ScriptedIntent,
): ScriptedIntent {
  const a = state.agents[id]!
  const here = a.insideId === undefined ? undefined : state.structures[a.insideId]
  if (intent.verb !== 'sleep') return here ? { verb: 'exit', params: {} } : intent
  if (a.collapsedSinceTick !== null) return intent // a body already down may lie where it fell
  if (here) return isRoofedKind(config, here.kind) ? intent : { verb: 'exit', params: {} }
  for (const sid of Object.keys(state.structures).sort()) {
    const s = state.structures[sid]!
    if (s.stage !== 'complete' || !isRoofedKind(config, s.kind)) continue
    const door = doorTile(state, s)
    if (door && cheb(a.x, a.y, door.x, door.y) <= 1)
      return { verb: 'enter', params: { structureId: s.id } }
  }
  return intent
}

export type ScriptedOnTick = (ctx: {
  tick: number
  emit: (type: string, payload: unknown) => void
}) => void

// getState() must return the *current* loop state; every decision is recomputed from it, so the
// handler has no hidden mutable state and replays bit-identically from the store.
export function makeScriptedOnTick(
  config: SimConfig,
  rng: RngStreams,
  getState: () => WorldState,
): ScriptedOnTick {
  const policies = makePolicies(config)
  const worldTick = createWorldTick(config, rng)
  return ({ tick, emit }) => {
    scriptedTimeline(config, tick, emit)

    // World pipeline (weather, fire, crops, wildlife, needs, health, aging, actions, collapse/death).
    const result = worldTick(getState())
    for (const e of result.events) emit(e.type, e.payload)

    // build is one long continuous activity and submitIntent rejects any other intent while it
    // runs, so the Builder's rest break and eat break are scripted here.
    const builder = getState().agents[BUILDER]
    if (builder && builder.alive && builder.activity?.verb === 'build') {
      if (builder.needs.energy < 30)
        emit('needs_changed', { id: BUILDER, changes: [{ need: 'energy', delta: 70 }] })
      const holdsFood = Object.values(getState().items).some(
        (i) =>
          i.loc.t === 'agent' &&
          i.loc.id === BUILDER &&
          (FOOD_KINDS.has(i.kind) || Object.prototype.hasOwnProperty.call(config.crops, i.kind)),
      )
      if (builder.needs.hunger < 60 && holdsFood)
        emit('action_interrupted', { agentId: BUILDER, reason: 'rest' })
    }
    // Policies submit intents against the freshly-advanced state.
    for (const id of ACTORS) {
      const state = getState()
      const a = state.agents[id]
      if (!a?.alive) continue
      const packet = composePerception(state, config, id, [])
      const intent = policies[id]!(packet)
      if (!intent) continue
      const gated = bedGate(state, config, id, intent)
      const r = submitIntent(state, config, id, gated.verb, gated.params)
      if (r.ok) for (const e of r.events) emit(e.type, e.payload)
    }
  }
}

export function createScriptedLoop(config: SimConfig, seed: string, store?: EventStore): TickLoop {
  const rng = new RngStreams(seed)
  const state = genesisState(config, makeFixtureMap())
  const s = store ?? new EventStore(openDb(':memory:'))
  const loop: TickLoop = new TickLoop({
    store: s,
    state,
    rng,
    config,
    snapshotEveryTicks: 120,
    onTick: makeScriptedOnTick(config, rng, () => loop.state),
  })
  return loop
}
