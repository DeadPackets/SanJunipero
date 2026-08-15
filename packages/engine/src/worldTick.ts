import type { SimConfig } from '@sj/shared'
import type { WorldState } from './state.js'
import { fold } from './fold.js'
import type { RngStreams } from './rng.js'
import { stepBuild, stepWalk, VERBS, type PendingEvent } from './verbs.js'
import { needsSystem } from './systems/needs.js'
import { healthSystem } from './systems/health.js'
import { agingSystem } from './systems/aging.js'
import { weatherSystem } from './systems/weather.js'
import { fireSystem } from './systems/fire.js'
import { cropsSystem } from './systems/crops.js'
import { wildlifeSystem } from './systems/wildlife.js'

export type TickCtx = {
  readonly config: SimConfig
  readonly rng: RngStreams
  state(): WorldState
  emit(type: string, payload: unknown): void
}
export type System = (ctx: TickCtx) => void
export type WorldTickResult = { state: WorldState; events: PendingEvent[] }

function actionsSystem(ctx: TickCtx): void {
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const a = ctx.state().agents[id]!
    if (!a.alive || !a.activity) continue
    if (a.activity.verb === 'walk') {
      const path = a.activity.path
      const tilesLeft = path ? path.length - (path.findIndex(([x, y]) => x === a.x && y === a.y) + 1) : 0
      if (tilesLeft <= 0) {
        ctx.emit('action_interrupted', { agentId: id, reason: 'blocked' })
        continue
      }
      for (const e of stepWalk(ctx.state(), id)) ctx.emit(e.type, e.payload)
    } else if (a.activity.verb === 'build') {
      for (const e of stepBuild(ctx.state(), id)) ctx.emit(e.type, e.payload)
    } else {
      ctx.emit('action_progressed', { agentId: id, ticks: 1 })
    }
    const act = ctx.state().agents[id]!.activity
    if (!act || act.ticksRemaining > 0) continue
    const def = VERBS[act.verb]
    const results = def?.results?.(ctx.state(), ctx.config, id, act.params)
    ctx.emit('action_completed', { agentId: id, verb: act.verb, ...(results ? { results } : {}) })
    if (!def) continue
    for (const e of def.onComplete(ctx.state(), ctx.config, id, act.params, ctx.rng.get(def.rngStream ?? 'actions'))) ctx.emit(e.type, e.payload)
    if (def.skill) ctx.emit('skill_gained', { agentId: id, track: def.skill.track, xp: def.skill.xp })
  }
}

function collapseDeathSystem(ctx: TickCtx): void {
  const { collapseThreshold, deathAfterZeroHungerTicks } = ctx.config.needs
  const { collapseHp, deathHp } = ctx.config.health
  for (const id of Object.keys(ctx.state().agents).sort()) {
    const a = ctx.state().agents[id]!
    if (!a.alive) continue
    const down = a.needs.hunger < collapseThreshold || a.needs.energy < collapseThreshold || a.hp < collapseHp
    if (down && a.collapsedSinceTick === null) {
      if (a.activity) ctx.emit('action_interrupted', { agentId: id, reason: 'collapsed' })
      ctx.emit('agent_collapsed', { agentId: id })
    }
    const b = ctx.state().agents[id]!
    const starved = b.zeroHungerSinceTick !== null && ctx.state().tick - b.zeroHungerSinceTick > deathAfterZeroHungerTicks
    if (starved || b.hp <= deathHp) {
      ctx.emit('agent_died', { agentId: id, cause: starved ? 'starvation' : 'health' })
    }
  }
}

const SYSTEMS: System[] = [
  weatherSystem, fireSystem, cropsSystem, wildlifeSystem,
  needsSystem, healthSystem, agingSystem, actionsSystem, collapseDeathSystem,
]

// Each emit folds immediately, so every system — and every later event within a
// system — is generated against the already-folded state, never a stale snapshot.
export function createWorldTick(config: SimConfig, rng: RngStreams): (state: WorldState) => WorldTickResult {
  return (initial) => {
    let state = initial
    const events: PendingEvent[] = []
    const ctx: TickCtx = {
      config,
      rng,
      state: () => state,
      emit: (type, payload) => {
        state = fold(state, { seq: 0, tick: state.tick, type, payload }, config)
        events.push({ type, payload })
      },
    }
    for (const system of SYSTEMS) system(ctx)
    return { state, events }
  }
}
