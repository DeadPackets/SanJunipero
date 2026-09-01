import type { SimConfig } from '@sj/shared'
import type { WorldState } from './state.js'
import { fold } from './fold.js'
import { effectiveConfig, type LawQueue } from './laws.js'
import type { RngStreams } from './rng.js'
import type { System, TickCtx } from './tickCtx.js'
import { stepBuild, stepWalk, VERBS, type PendingEvent } from './verbs/index.js'
import { needsSystem } from './systems/needs.js'
import { flushNeedsSystem } from './systems/needsBatch.js'
import { warmthSystem } from './systems/warmth.js'
import { lightingSystem } from './systems/lighting.js'
import { regrowthSystem } from './systems/regrowth.js'
import { healthSystem } from './systems/health.js'
import {
  deathAttribution,
  dropHeldItems,
  escalateFatigue,
  mortalitySystem,
  placeGrave,
} from './systems/mortality.js'
import { illnessSystem } from './systems/illness.js'
import { desirePathsSystem } from './systems/desirePaths.js'
import { thirstSystem } from './systems/thirst.js'
import { agingSystem } from './systems/aging.js'
import { weatherSystem } from './systems/weather.js'
import { fireSystem } from './systems/fire.js'
import { cropsSystem } from './systems/crops.js'
import { wildlifeSystem } from './systems/wildlife.js'
import { faunaSystem } from './systems/fauna.js'
import { forageSystem } from './systems/forage.js'
import { spoilageSystem } from './systems/spoilage.js'
import { reproductionSystem } from './systems/reproduction.js'
import { mysterySystem } from './systems/mystery.js'
import { mapGrowthSystem } from './systems/mapGrowth.js'
import { sightSystem } from './systems/sight.js'

export type WorldTickResult = { state: WorldState; events: PendingEvent[] }

function actionsSystem(ctx: TickCtx): void {
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const a = ctx.state().agents[id]!
    if (!a.alive || !a.activity) continue
    if (a.activity.verb === 'walk') {
      const path = a.activity.path
      const tilesLeft = path
        ? path.length - (path.findIndex(([x, y]) => x === a.x && y === a.y) + 1)
        : 0
      // No tiles and no clock is a body that was standing at its destination when it set off:
      // that walk is done, not stopped, and it completes below like any other.
      if (tilesLeft <= 0 && a.activity.ticksRemaining > 0) {
        ctx.emit('action_interrupted', { agentId: id, reason: 'blocked' })
        continue
      }
      if (tilesLeft > 0) for (const e of stepWalk(ctx.state(), id)) ctx.emit(e.type, e.payload)
    } else if (a.activity.verb === 'build') {
      for (const e of stepBuild(ctx.state(), ctx.config, id)) ctx.emit(e.type, e.payload)
    } else {
      ctx.emit('action_progressed', { agentId: id, ticks: 1 })
    }
    const act = ctx.state().agents[id]!.activity
    if (!act || act.ticksRemaining > 0) continue
    const def = VERBS[act.verb]
    const results = def?.results?.(ctx.state(), ctx.config, id, act.params)
    ctx.emit('action_completed', { agentId: id, verb: act.verb, ...(results ? { results } : {}) })
    if (!def) continue
    for (const e of def.onComplete(
      ctx.state(),
      ctx.config,
      id,
      act.params,
      ctx.rng.get(def.rngStream ?? 'actions'),
    ))
      ctx.emit(e.type, e.payload)
    if (def.skill)
      ctx.emit('skill_gained', { agentId: id, track: def.skill.track, xp: def.skill.xp })
  }
}

function collapseDeathSystem(ctx: TickCtx): void {
  const { collapseThreshold, deathAfterZeroHungerTicks } = ctx.config.needs
  const { collapseHp, deathHp } = ctx.config.health
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const a = ctx.state().agents[id]!
    if (!a.alive) continue
    const down =
      a.needs.hunger < collapseThreshold || a.needs.energy < collapseThreshold || a.hp < collapseHp
    const fell = down && a.collapsedSinceTick === null
    if (fell) {
      if (a.activity) ctx.emit('action_interrupted', { agentId: id, reason: 'collapsed' })
      ctx.emit('agent_collapsed', { agentId: id })
    }
    const b = ctx.state().agents[id]!
    const starved =
      b.zeroHungerSinceTick !== null &&
      ctx.state().tick - b.zeroHungerSinceTick > deathAfterZeroHungerTicks
    if (starved || b.hp <= deathHp) {
      // Attribution reads the living body: after agent_died there is nothing left to ask.
      const { cause, byId } = starved
        ? { cause: 'hunger' as const, byId: undefined }
        : deathAttribution(ctx.state(), ctx.config, id)
      dropHeldItems(ctx, id)
      ctx.emit('agent_died', { agentId: id, cause, ...(byId === undefined ? {} : { byId }) })
      placeGrave(ctx, id)
      continue
    }
    // A fall you never get up from is not exhaustion, it is the end — the ladder is for
    // the ones still breathing at the foot of it.
    if (fell) escalateFatigue(ctx, id)
  }
}

// mapGrowth runs before anything that reads a coordinate this tick: after it, every stored
// position may have moved, and a system holding a pre-growth position would act on the wrong tile.
const SYSTEMS: System[] = [
  weatherSystem,
  mysterySystem,
  mapGrowthSystem,
  fireSystem,
  cropsSystem,
  wildlifeSystem,
  faunaSystem,
  forageSystem,
  spoilageSystem,
  lightingSystem,
  needsSystem,
  warmthSystem,
  thirstSystem,
  flushNeedsSystem,
  healthSystem,
  mortalitySystem,
  illnessSystem,
  desirePathsSystem,
  regrowthSystem,
  reproductionSystem,
  agingSystem,
  actionsSystem,
  collapseDeathSystem,
  // Last: the legs have already moved and the door has already opened, so what a body learned
  // this tick is learned on the tick it happened.
  sightSystem,
]

// Each emit folds immediately, so every system is generated against the already-folded state.
// ctx.config is a getter: a law flipped at this boundary is true for every system that runs after.
export function createWorldTick(
  config: SimConfig,
  rng: RngStreams,
  laws?: LawQueue,
): (state: WorldState) => WorldTickResult {
  return (initial) => {
    let state = initial
    const events: PendingEvent[] = []
    const ctx: TickCtx = {
      get config() {
        return effectiveConfig(config, state.laws)
      },
      rng,
      needs: new Map(),
      state: () => state,
      emit: (type, payload) => {
        state = fold(state, { seq: 0, tick: state.tick, type, payload }, config)
        events.push({ type, payload })
      },
    }
    // Legislation before physics: a law changes at a tick boundary and never mid-tick.
    if (laws !== undefined) {
      for (const { path, value } of laws.splice(0)) ctx.emit('config_changed', { path, value })
    }
    for (const system of SYSTEMS) system(ctx)
    return { state, events }
  }
}
