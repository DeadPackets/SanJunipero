import { z } from 'zod'
import type { SimConfig } from '@sj/shared'
import type { WorldState } from './state.js'
import type { RngStream } from './rng.js'
import { findPath, isPassable } from './path.js'

export type PendingEvent = { type: string; payload: unknown }
export type VerbKind = 'walk' | 'sleep' | 'wake' | 'eat'

export type VerbDef = {
  kind: VerbKind
  validate(state: WorldState, config: SimConfig, agentId: string, params: Record<string, unknown>): string | null
  duration(state: WorldState, config: SimConfig, agentId: string, params: Record<string, unknown>): number
  onComplete(state: WorldState, config: SimConfig, agentId: string, params: Record<string, unknown>, rng: RngStream): PendingEvent[]
  interruptible: boolean
  skill?: { track: string; xp: number }
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

// v1 food registry; lifts into config when cooking/foraging land.
export const FOOD_KINDS: ReadonlySet<string> = new Set(['berries', 'fish', 'venison', 'bread', 'wheat'])

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

export const VERBS: Record<string, VerbDef> = { walk, sleep, wake, eat }

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
