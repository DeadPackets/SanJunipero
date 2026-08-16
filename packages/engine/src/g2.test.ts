// @slow — GATE G2, ~4320 ticks (documentary marker per plan; no vitest tag support, runs in CI)
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, stateHash, type SimEvent } from '@sj/shared'
import type { WorldState } from './state.js'
import { openDb } from './db.js'
import { EventStore } from './eventStore.js'
import { TickLoop } from './tickLoop.js'
import { replayFromGenesis, replayLatest } from './replay.js'
import {
  createScriptedLoop, makeScriptedOnTick, makeFixtureMap,
  FARMER, FISHER, IDLER, STOREHOUSE, SHED,
} from './scripted.js'
// Pinned golden hash for the 3-day scripted world run (regen #3, deliberate:
// collapsed-sleep recovery + crop stage formula changed the scripted timeline).
const GOLDEN_G2_HASH = '7263dde98076dbb234bdeded24aab659987190ce00e4581999027d615ec977e8'

const SEED = 'g2-scripted'
const TOTAL_TICKS = 4320 // 3 sim days

type Payload = Record<string, unknown>

function runTicks(loop: TickLoop, n: number): void {
  for (let i = 0; i < n; i++) loop.step()
}

function allEvents(store: EventStore): SimEvent[] {
  return store.readFrom(0)
}

function runScenario(seed = SEED): { state: WorldState; store: EventStore; evs: SimEvent[] } {
  const store = new EventStore(openDb(':memory:'))
  const loop = createScriptedLoop(DEFAULT_CONFIG, seed, store)
  runTicks(loop, TOTAL_TICKS)
  return { state: loop.state, store, evs: allEvents(store) }
}

describe('GATE G2: 3-day scripted world run', () => {
  it('survival, rescue, death, build, fire, and crops all land in 3 sim days', () => {
    const { state, evs } = runScenario()

    // 1. Farmer + Fisher alive with hunger never touching zero.
    expect(state.agents[FARMER]!.alive).toBe(true)
    expect(state.agents[FISHER]!.alive).toBe(true)
    expect(state.agents[FARMER]!.zeroHungerSinceTick).toBeNull()
    expect(state.agents[FISHER]!.zeroHungerSinceTick).toBeNull()
    expect(state.agents[FARMER]!.needs.hunger).toBeGreaterThan(0)
    expect(state.agents[FISHER]!.needs.hunger).toBeGreaterThan(0)

    // 2. Idler collapses before death; starvation death lands on the exact tick.
    const collapseEv = evs.find((e) => e.type === 'agent_collapsed' && (e.payload as Payload).agentId === IDLER)
    expect(collapseEv).toBeDefined()
    const diedEv = evs.find((e) => e.type === 'agent_died' && (e.payload as Payload).agentId === IDLER)
    expect(diedEv).toBeDefined()
    expect((diedEv!.payload as Payload).cause).toBe('starvation')
    expect(collapseEv!.tick).toBeLessThan(diedEv!.tick)
    const zeroTick = state.agents[IDLER]!.zeroHungerSinceTick
    expect(zeroTick).not.toBeNull()
    expect(diedEv!.tick).toBe(zeroTick! + DEFAULT_CONFIG.needs.deathAfterZeroHungerTicks + 1)

    // 3. Builder's hut completes.
    const hut = Object.values(state.structures).find((s) => s.kind === 'hut')
    expect(hut?.stage).toBe('complete')

    // 4. Day-2 fire: ignited, spreads to the adjacent shed, doused by rain; count unchanged.
    expect(evs.some((e) => e.type === 'fire_ignited' && (e.payload as Payload).structureId === STOREHOUSE.id)).toBe(true)
    expect(evs.some((e) => e.type === 'fire_spread'
      && (e.payload as Payload).fromId === STOREHOUSE.id && (e.payload as Payload).toId === SHED.id)).toBe(true)
    expect(evs.some((e) => e.type === 'fire_extinguished'
      && (e.payload as Payload).structureId === STOREHOUSE.id && (e.payload as Payload).cause === 'rain')).toBe(true)
    expect(evs.some((e) => e.type === 'fire_extinguished'
      && (e.payload as Payload).structureId === SHED.id && (e.payload as Payload).cause === 'rain')).toBe(true)
    expect(Object.keys(state.structures)).toHaveLength(3)

    // 5. Wheat planted day 1: stage 0 after 2 dawns (floor(2×3/8)), not mature (growthDays 8), not withered.
    const wheat = Object.values(state.crops).find((c) => c.kind === 'wheat')
    expect(wheat).toBeDefined()
    expect(wheat!.stage).toBe(0)
    expect(wheat!.withered).toBe(false)
    expect(wheat!.stage).not.toBe(DEFAULT_CONFIG.crops.wheat!.stages - 1)

    // Rescue flow: collapsed Idler fed via give + eat (eat exempt), recovers, then dies.
    const giveEv = evs.find((e) => e.type === 'item_moved'
      && (e.payload as Payload).loc !== undefined
      && ((e.payload as Payload).loc as Payload).t === 'agent'
      && ((e.payload as Payload).loc as Payload).id === IDLER)
    expect(giveEv).toBeDefined()
    expect(collapseEv!.tick).toBeLessThan(giveEv!.tick)
    const eatEv = evs.find((e) => e.type === 'need_changed'
      && (e.payload as Payload).id === IDLER
      && (e.payload as Payload).need === 'hunger'
      && (e.payload as Payload).delta === DEFAULT_CONFIG.needs.eatRestoreHunger)
    expect(eatEv).toBeDefined()
    expect(giveEv!.tick).toBeLessThan(eatEv!.tick)
    // After eating, the Idler can act again (walk) -> collapse cleared.
    const actEv = evs.find((e) => e.type === 'action_started'
      && (e.payload as Payload).agentId === IDLER
      && (e.payload as Payload).verb === 'walk'
      && e.tick >= eatEv!.tick)
    expect(actEv).toBeDefined()
    expect(actEv!.tick).toBeLessThan(diedEv!.tick)

    expect(stateHash(state)).toBe(GOLDEN_G2_HASH)
  })

  it('is deterministic: two runs from the same seed hash identically', () => {
    const a = runScenario()
    const b = runScenario()
    expect(stateHash(a.state)).toBe(stateHash(b.state))
  })

  it('replayFromGenesis equals the live run, config threaded explicitly', () => {
    const { state, store } = runScenario()
    expect(stateHash(replayFromGenesis(store, DEFAULT_CONFIG, makeFixtureMap()))).toBe(stateHash(state))
  })

  it('crash at tick 2000: recover, continue to 4320, hash equals uninterrupted run', () => {
    const ref = runScenario()

    const dir = mkdtempSync(join(tmpdir(), 'sj-g2-'))
    const dbPath = join(dir, 'town.db')
    try {
      const store = new EventStore(openDb(dbPath))
      const loop1 = createScriptedLoop(DEFAULT_CONFIG, SEED, store)
      runTicks(loop1, 2000)

      // "crash": no clean shutdown; recover from the durable store.
      const rec = replayLatest(store, DEFAULT_CONFIG, makeFixtureMap())
      const loop2: TickLoop = new TickLoop({
        store, state: rec.state, rng: rec.rng, config: DEFAULT_CONFIG, startTick: rec.state.tick,
        snapshotEveryTicks: 120,
        onTick: makeScriptedOnTick(DEFAULT_CONFIG, rec.rng, () => loop2.state),
      })
      runTicks(loop2, TOTAL_TICKS - rec.state.tick)
      expect(stateHash(loop2.state)).toBe(stateHash(ref.state))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
