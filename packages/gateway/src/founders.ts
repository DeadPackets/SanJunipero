// Founders dev world script: the five approved founders walk the town among the
// approved building set. Deterministic (no Math.random) — same laws as the engine's
// scripted module: policies are pure functions of perception, timeline is tick-keyed.
import type { SimConfig } from '@sj/shared'
import {
  composePerception, createWorldTick, doorTile, submitIntent,
  type PerceptionPacket, type RngStreams, type WorldState,
} from '@sj/engine'
import { devTown, type DevStructure } from './devTown.js'
// Type-only, so no import cycle survives compilation.
import type { DevMapKind } from './devWorld.js'

export type FounderDef = {
  id: string
  name: string
  ageDays: number
  spawn: { x: number; y: number }
  patrol: [{ x: number; y: number }, { x: number; y: number }]
}

// map fixture: river x<=3, forest x>=61, grass between (engine makeFixtureMap)
export const FOUNDERS: readonly FounderDef[] = [
  { id: 'omar', name: 'Omar', ageDays: 24 * 364, spawn: { x: 6, y: 32 }, patrol: [{ x: 6, y: 32 }, { x: 20, y: 23 }] },
  { id: 'amara', name: 'Amara', ageDays: 35 * 364, spawn: { x: 21, y: 23 }, patrol: [{ x: 21, y: 23 }, { x: 31, y: 23 }] },
  { id: 'yusuf', name: 'Yusuf', ageDays: 55 * 364, spawn: { x: 34, y: 24 }, patrol: [{ x: 34, y: 24 }, { x: 24, y: 21 }] },
  { id: 'nadia', name: 'Nadia', ageDays: 26 * 364, spawn: { x: 26, y: 20 }, patrol: [{ x: 26, y: 20 }, { x: 16, y: 28 }] },
  { id: 'salma', name: 'Salma', ageDays: 45 * 364, spawn: { x: 28, y: 26 }, patrol: [{ x: 28, y: 26 }, { x: 28, y: 18 }] },
]

export type TownStructure = { id: string; kind: string; x: number; y: number; w: number; h: number }

// the approved building set, placed complete on day 0 (this is an art-showcase town)
export const TOWN_STRUCTURES: readonly TownStructure[] = [
  { id: 'structure_storehouse', kind: 'storehouse', x: 20, y: 20, w: 2, h: 2 },
  { id: 'structure_shed', kind: 'shed', x: 23, y: 20, w: 1, h: 1 },
  { id: 'structure_cottage', kind: 'hut', x: 30, y: 20, w: 2, h: 2 },
  { id: 'structure_wagon', kind: 'wagon', x: 26, y: 25, w: 1, h: 2 },
  { id: 'structure_scaffolding', kind: 'scaffolding', x: 34, y: 23, w: 1, h: 1 },
  { id: 'structure_stone', kind: 'standing_stone', x: 15, y: 28, w: 1, h: 1 },
]

// The scripted fixture keeps its own unowned, unburnable-by-kind shape so every landed gate
// folds exactly the events it always folded.
const SCRIPTED_STRUCTURES: readonly DevStructure[] = TOWN_STRUCTURES.map((s) => ({
  ...s, owner: null, flammable: s.kind !== 'standing_stone',
}))

/** 'scripted' keeps the frozen G6 fixture set; 'showcase' serves the town the roads were drawn for. */
export function townStructuresFor(map: DevMapKind): readonly DevStructure[] {
  return map === 'showcase' ? devTown().structures : SCRIPTED_STRUCTURES
}

// The one dwelling in the fixture town — where a tired founder goes when interiors are on.
export const FOUNDERS_HOME_ID = 'structure_cottage'
// Above the patrol policy's own outdoor-sleep threshold (20), so home always wins first —
// measured over 5500 dev ticks, no founder ever sleeps or collapses out of doors.
export const GO_HOME_BELOW = 25
export const LEAVE_HOME_ABOVE = 80
// MEASURED (2026-08-17): the five founders first go indoors at ticks 820-875 and make ten
// indoor trips per 1500 ticks thereafter. DEV_FAST_FORWARD=1200 lands the world just AFTER
// that first cycle with everyone freshly rested at energy 66-73, so a viewer then waits
// ~450 ticks — nineteen real minutes — for the next one. Start here instead and the walk
// home is the first thing the checklist sees.
export const DEV_FAST_FORWARD_FOR_INTERIORS = 810

export const NEED_TOPUP_BELOW = 40
export const HUNGER_TOPUP = 55
export const WARMTH_TOPUP = 50

// patrol like the G2 idler: ping-pong between two fixed waypoints, sleep when spent
function makePatrolPolicy(f: FounderDef) {
  const [a, b] = f.patrol
  return (p: PerceptionPacket): { verb: string; params: Record<string, unknown> } | null => {
    if (p.self.body.needs.energy < 20) return { verb: 'sleep', params: {} }
    const dest = p.self.x === a.x && p.self.y === a.y ? b : a
    return { verb: 'walk', params: { x: dest.x, y: dest.y } }
  }
}

export type FoundersOnTick = (ctx: { tick: number; emit: (type: string, payload: unknown) => void }) => void

export type FoundersOpts = {
  /** dev/demo only: a tired founder walks home, goes in, sleeps, and comes out again.
   *  OFF by default, so every existing gate folds exactly the events it always did. */
  interiors?: boolean
  /** The town to raise on tick 1. Defaults to the frozen scripted fixture, so every existing
   *  caller and every existing test folds exactly the world it always did. */
  structures?: readonly DevStructure[]
}

// Walking home is a whole errand, so it is decided from world state rather than from the
// patrol packet: the door tile, the distance to it and `insideId` are all facts of the world.
export function homeIntent(state: WorldState, agentId: string): { verb: string; params: Record<string, unknown> } | null {
  const a = state.agents[agentId]
  if (a === undefined) return null
  if (a.insideId !== undefined) {
    return a.needs.energy > LEAVE_HOME_ABOVE ? { verb: 'exit', params: {} } : { verb: 'sleep', params: {} }
  }
  if (a.needs.energy >= GO_HOME_BELOW) return null
  const home = state.structures[FOUNDERS_HOME_ID]
  const door = home === undefined ? null : doorTile(state, home)
  if (door === null) return null
  return Math.abs(a.x - door.x) <= 1 && Math.abs(a.y - door.y) <= 1
    ? { verb: 'enter', params: { structureId: FOUNDERS_HOME_ID } }
    : { verb: 'walk', params: { x: door.x, y: door.y } }
}

export function makeFoundersOnTick(
  config: SimConfig, rng: RngStreams, getState: () => WorldState, opts: FoundersOpts = {},
): FoundersOnTick {
  const policies = new Map(FOUNDERS.map(f => [f.id, makePatrolPolicy(f)]))
  const worldTick = createWorldTick(config, rng)
  const structures = opts.structures ?? SCRIPTED_STRUCTURES
  return ({ tick, emit }) => {
    if (tick === 1) {
      for (const f of FOUNDERS) {
        emit('agent_spawned', { id: f.id, name: f.name, x: f.spawn.x, y: f.spawn.y, ageDays: f.ageDays })
      }
      for (const s of structures) {
        // `owner` rides along only when there is one, so the scripted fixture's payload is
        // byte-identical to the one every landed gate already folded.
        emit('structure_planned', {
          id: s.id, kind: s.kind, x: s.x, y: s.y, w: s.w, h: s.h, maxHp: 20,
          flammable: s.flammable, builderId: 'script',
          ...(s.owner === null ? {} : { owner: s.owner }),
        })
        emit('structure_completed', { id: s.id })
      }
    }

    const result = worldTick(getState())
    for (const e of result.events) emit(e.type, e.payload)

    // scripted need top-ups keep the showcase town alive without a food economy
    for (const f of FOUNDERS) {
      const a = getState().agents[f.id]
      if (!a || !a.alive) continue
      if (a.needs.hunger < NEED_TOPUP_BELOW) emit('need_changed', { id: f.id, need: 'hunger', delta: HUNGER_TOPUP })
      if (a.needs.warmth < NEED_TOPUP_BELOW) emit('need_changed', { id: f.id, need: 'warmth', delta: WARMTH_TOPUP })
    }

    for (const f of FOUNDERS) {
      const state = getState()
      const a = state.agents[f.id]
      if (!a || !a.alive) continue
      const packet = composePerception(state, config, f.id, [])
      const intent = (opts.interiors === true ? homeIntent(state, f.id) : null)
        ?? policies.get(f.id)!(packet)
      if (!intent) continue
      const r = submitIntent(state, config, f.id, intent.verb, intent.params)
      if (r.ok) for (const e of r.events) emit(e.type, e.payload)
    }
  }
}
