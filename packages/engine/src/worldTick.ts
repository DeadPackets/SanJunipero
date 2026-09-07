import type { SimConfig } from '@sj/shared'
import type { WorldState } from './state.js'
import { fold } from './fold.js'
import { effectiveConfig, type LawQueue } from './laws.js'
import type { RngStreams } from './rng.js'
import type { System, TickCtx } from './tickCtx.js'
import { isLightWork, NOD_OFF_ENERGY, SPENT_ENERGY, submitIntent } from './intent.js'
import {
  chaseStep,
  fallsAsleep,
  SPENT_OUT,
  stepBuild,
  stepWalk,
  VERBS,
  type PendingEvent,
} from './verbs/index.js'
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
      // A walk that named a person is re-aimed at where they are standing now: the mark moves,
      // so a route laid once is stale by the second tick.
      const chase = chaseStep(ctx.state(), ctx.config, id)
      if (chase !== null) {
        for (const e of chase) ctx.emit(e.type, e.payload)
      } else {
        const path = a.activity.path
        const tilesLeft = path
          ? path.length - (path.findIndex(([x, y]) => x === a.x && y === a.y) + 1)
          : 0
        if (tilesLeft > 0) {
          for (const e of stepWalk(ctx.state(), id)) ctx.emit(e.type, e.payload)
        } else if (a.activity.ticksRemaining > 0) {
          ctx.emit('action_interrupted', { agentId: id, reason: 'blocked' })
          continue
        }
        // No tiles and no clock left is a body that set off already standing at its destination:
        // that walk is done, not stopped, and it completes below like any other.
      }
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
    // The act these legs were set going for. The walk is over, so it can begin; a world that
    // moved on while they walked simply leaves the body standing there, free to choose again.
    if (act.then) {
      const next = submitIntent(ctx.state(), ctx.config, id, act.then.verb, act.then.params)
      if (next.ok) for (const e of next.events) ctx.emit(e.type, e.payload)
    }
  }
}

// r37: the walls went up at six energy until the body fell. Spent hands stop before the act
// steps, and the mind is told why.
function spentSystem(ctx: TickCtx): void {
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const a = ctx.state().agents[id]!
    if (!a.alive || a.asleep || a.collapsedSinceTick !== null) continue
    if (a.needs.energy >= SPENT_ENERGY || a.activity === null) continue
    if (isLightWork(a.activity.verb)) continue
    ctx.emit('action_interrupted', { agentId: id, reason: SPENT_OUT })
  }
}

// Owner 2026-09-07: a collapse needs a cause. A body that will not take itself to bed nods off
// where it is once the last of its energy goes, and wakes rested instead of on the ground.
const NODDED_OFF = 'nodded off'
function nodOffSystem(ctx: TickCtx): void {
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const a = ctx.state().agents[id]!
    if (!a.alive || a.asleep || a.collapsedSinceTick !== null) continue
    if (a.needs.energy >= NOD_OFF_ENERGY) continue
    if (a.activity) ctx.emit('action_interrupted', { agentId: id, reason: NODDED_OFF })
    for (const e of fallsAsleep(ctx.state(), id, 'nodded_off')) ctx.emit(e.type, e.payload)
  }
}

function collapseDeathSystem(ctx: TickCtx): void {
  const { collapseThreshold, deathAfterZeroHungerTicks } = ctx.config.needs
  const { collapseHp, deathHp, downedPassOutTicks } = ctx.config.health
  const { needsKill } = ctx.config.mortality
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const a = ctx.state().agents[id]!
    if (!a.alive) continue
    // A sleeper's energy only climbs, so under the floor asleep means it nodded off this tick.
    const down =
      a.needs.hunger < collapseThreshold ||
      (a.needs.energy < collapseThreshold && !a.asleep) ||
      a.hp < collapseHp
    const fell = down && a.collapsedSinceTick === null
    if (fell) {
      if (a.activity) ctx.emit('action_interrupted', { agentId: id, reason: 'collapsed' })
      // Falling wakes you. World one lost Nadia to the other answer: her hunger crossed the line
      // in her sleep, and a body that is asleep AND down has no road out at all — it cannot eat,
      // call for help or crawl. Lying down again while down is still its own choice.
      if (a.asleep) ctx.emit('agent_woke', { agentId: id })
      ctx.emit('agent_collapsed', { agentId: id })
    }
    // Except when sleep is the only road out: a body down for want of rest alone, fed and unhurt,
    // is kept awake for an hour to eat, call or crawl, and then passes out where it lies.
    const tiredOnly =
      !fell &&
      a.collapsedSinceTick !== null &&
      !a.asleep &&
      a.needs.energy < collapseThreshold &&
      a.needs.hunger >= collapseThreshold &&
      a.hp >= collapseHp &&
      ctx.state().tick - a.collapsedSinceTick >= downedPassOutTicks
    if (tiredOnly) {
      if (a.activity) ctx.emit('action_interrupted', { agentId: id, reason: 'passed out' })
      ctx.emit('agent_passed_out', { agentId: id })
    }
    const b = ctx.state().agents[id]!
    const starved =
      needsKill &&
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
  spentSystem,
  actionsSystem,
  nodOffSystem,
  collapseDeathSystem,
  // Last: the legs have already moved and the door has already opened, so what a body learned
  // this tick is learned on the tick it happened.
  sightSystem,
]

// Each emit folds immediately, so every system is generated against the already-folded state.
// A driver that folds what it writes hands its `apply` in and the tick folds through that, once.
// ctx.config is a getter: a law flipped at this boundary is true for every system that runs after.
export function createWorldTick(
  config: SimConfig,
  rng: RngStreams,
  laws?: LawQueue,
): (state: WorldState, apply?: (type: string, payload: unknown) => WorldState) => WorldTickResult {
  return (initial, apply) => {
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
        state =
          apply === undefined
            ? fold(state, { seq: 0, tick: state.tick, type, payload }, config)
            : apply(type, payload)
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
