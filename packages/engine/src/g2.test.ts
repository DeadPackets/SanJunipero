// @slow — GATE G2, ~4320 ticks (documentary marker per plan; no vitest tag support, runs in CI)
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dayPhaseFromTick, SimConfigSchema, stateHash, type SimEvent } from '@sj/shared'
import { genesisState, type WorldState } from './state.js'
import { openDb } from './db.js'
import { fold } from './fold.js'
import { EventStore } from './eventStore.js'
import { TickLoop } from './tickLoop.js'
import { replayFromGenesis, replayLatest } from './replay.js'
import {
  createScriptedLoop,
  makeScriptedOnTick,
  makeFixtureMap,
  BUILDER,
  FARMER,
  FISHER,
  IDLER,
  STOREHOUSE,
  SHED,
  KEEPER,
  THIEF,
  STOLEN_ITEM,
  NIGHT_THEFT_TICK,
  NOON_THEFT_TICK,
} from './scripted.js'
import { composePerception } from './perception.js'
import { DEATH_CAUSES } from './systems/mortality.js'
import { nutritionOf } from './verbs.js'
// Nothing is suppressed in this world: mortality, thirst, fauna, warmth, light, the night
// witness, regrowth and desire paths are all live on the 3-day run.
const G2_CONFIG = SimConfigSchema.parse({})

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
  const loop = createScriptedLoop(G2_CONFIG, seed, store)
  runTicks(loop, TOTAL_TICKS)
  return { state: loop.state, store, evs: allEvents(store) }
}

describe('GATE G2: 3-day scripted world run', () => {
  // One run, read by every row below; only the determinism row builds a second, independent one.
  let G2: ReturnType<typeof runScenario>
  beforeAll(() => {
    G2 = runScenario()
  })

  it('survival, rescue, death, build, fire, and crops all land in 3 sim days', () => {
    const { state, evs } = G2

    // 1. Neither the Farmer nor the Fisher ever runs the hunger clock down — an old line, and
    // still true. What takes them is in the death table below.
    expect(state.agents[FARMER]!.zeroHungerSinceTick).toBeNull()
    expect(state.agents[FISHER]!.zeroHungerSinceTick).toBeNull()
    expect(state.agents[FARMER]!.needs.hunger).toBeGreaterThan(0)
    expect(state.agents[FISHER]!.needs.hunger).toBeGreaterThan(0)

    // hungerHpDrainPerTick empties an empty body's hp bar long before deathAfterZeroHungerTicks
    // runs out, so the death lands early and the attribution names what the old timer would have.
    const collapseEv = evs.find(
      (e) => e.type === 'agent_collapsed' && (e.payload as Payload).agentId === IDLER,
    )
    expect(collapseEv).toBeDefined()
    const diedEv = evs.find(
      (e) => e.type === 'agent_died' && (e.payload as Payload).agentId === IDLER,
    )
    expect(diedEv).toBeDefined()
    expect((diedEv!.payload as Payload).cause).toBe('hunger')
    expect(collapseEv!.tick).toBeLessThan(diedEv!.tick)
    const zeroTick = state.agents[IDLER]!.zeroHungerSinceTick
    expect(zeroTick).not.toBeNull()
    expect(state.agents[IDLER]!.hp).toBeLessThanOrEqual(G2_CONFIG.health.deathHp)
    expect(diedEv!.tick).toBeLessThan(zeroTick! + G2_CONFIG.needs.deathAfterZeroHungerTicks + 1)

    // The walls book the work the building is, never the hours the dark cost her. This fixture is
    // where workPenalty booked 2 903 ticks against a 2 880-tick house.
    const house = Object.values(state.structures).find((s) => s.kind === 'house')
    expect(house?.stage).toBe('complete')
    expect(house!.progressTicks).toBeLessThanOrEqual(G2_CONFIG.construction.houseTicks)

    // 4. Day-2 fire: ignited, spreads to the adjacent shed, doused by rain; count unchanged.
    expect(
      evs.some(
        (e) => e.type === 'fire_ignited' && (e.payload as Payload).structureId === STOREHOUSE.id,
      ),
    ).toBe(true)
    expect(
      evs.some(
        (e) =>
          e.type === 'fire_spread' &&
          (e.payload as Payload).fromId === STOREHOUSE.id &&
          (e.payload as Payload).toId === SHED.id,
      ),
    ).toBe(true)
    expect(
      evs.some(
        (e) =>
          e.type === 'fire_extinguished' &&
          (e.payload as Payload).structureId === STOREHOUSE.id &&
          (e.payload as Payload).cause === 'rain',
      ),
    ).toBe(true)
    expect(
      evs.some(
        (e) =>
          e.type === 'fire_extinguished' &&
          (e.payload as Payload).structureId === SHED.id &&
          (e.payload as Payload).cause === 'rain',
      ),
    ).toBe(true)
    // Three buildings and one stone for each of the two dead: graves are structures too.
    expect(Object.keys(state.structures)).toHaveLength(5)

    // 5. Wheat planted day 1: stage 0 after 2 dawns (floor(2×3/8)), not mature (growthDays 8), not withered.
    const wheat = Object.values(state.crops).find((c) => c.kind === 'wheat')
    expect(wheat).toBeDefined()
    expect(wheat!.stage).toBe(0)
    expect(wheat!.withered).toBe(false)
    expect(wheat!.stage).not.toBe(G2_CONFIG.crops.wheat!.stages - 1)

    // Rescue flow: collapsed Idler fed via give + eat (eat exempt), recovers, then dies. A fish is
    // worth less than the flat eatRestoreHunger, and nutritionOf is the one place that says so.
    const giveEv = evs.find(
      (e) =>
        e.type === 'item_moved' &&
        (e.payload as Payload).loc !== undefined &&
        ((e.payload as Payload).loc as Payload).t === 'agent' &&
        ((e.payload as Payload).loc as Payload).id === IDLER,
    )
    expect(giveEv).toBeDefined()
    expect(collapseEv!.tick).toBeLessThan(giveEv!.tick)
    // First meal of the run, so the variety bonus is nothing: the flat restore times the
    // fish's own worth, and no longer the flat restore.
    const firstFish = G2_CONFIG.needs.eatRestoreHunger * nutritionOf(G2_CONFIG, 'fish')
    expect(firstFish).toBeLessThan(G2_CONFIG.needs.eatRestoreHunger)
    const eatEv = evs.find(
      (e) =>
        e.type === 'need_changed' &&
        (e.payload as Payload).id === IDLER &&
        (e.payload as Payload).need === 'hunger' &&
        (e.payload as Payload).delta === firstFish,
    )
    expect(eatEv).toBeDefined()
    expect(giveEv!.tick).toBeLessThan(eatEv!.tick)
    // After eating, the Idler can act again (walk) -> collapse cleared.
    const actEv = evs.find(
      (e) =>
        e.type === 'action_started' &&
        (e.payload as Payload).agentId === IDLER &&
        (e.payload as Payload).verb === 'walk' &&
        e.tick >= eatEv!.tick,
    )
    expect(actEv).toBeDefined()
    expect(actEv!.tick).toBeLessThan(diedEv!.tick)
  })

  // If a later change quietly stops one of these laws firing, the hash row above would still
  // pass — so each law is named here as well as hashed.
  it('C9 is live in this run: things are owned, a body sleeps under a roof, food turns', () => {
    const { state, evs } = G2

    // Ownership: the Builder owns the house he raised, and the Fisher owns what he pulled out.
    const house = Object.values(state.structures).find((s) => s.kind === 'house')!
    expect(house.owner).toBe(BUILDER)
    const caught = Object.values(state.items).filter((i) => i.kind === 'fish')
    expect(caught.length).toBeGreaterThan(0)
    for (const f of caught) expect(f.owner).toBe(FISHER)
    expect(evs.some((e) => e.type === 'item_owner_changed')).toBe(true)

    // The bed law: the Builder steps through his own door and lies down inside it.
    const entered = evs.filter((e) => e.type === 'agent_entered')
    expect(entered.map((e) => (e.payload as Payload).agentId)).toContain(BUILDER)
    const inside = entered.find((e) => (e.payload as Payload).agentId === BUILDER)!
    const slept = evs.find(
      (e) => e.type === 'agent_slept' && (e.payload as Payload).agentId === BUILDER,
    )
    expect(slept).toBeDefined()
    expect(inside.tick).toBeLessThan(slept!.tick)
    expect((inside.payload as Payload).structureId).toBe(house.id)
    expect(state.agents[BUILDER]!.insideId).toBe(house.id)

    // Spoilage: a two-day fish does not survive a three-day run.
    const spoiled = evs.filter((e) => e.type === 'item_spoiled')
    expect(spoiled.length).toBeGreaterThan(0)
    for (const e of spoiled)
      expect(state.items[(e.payload as Payload).id as string]).toBeUndefined()

    // Reproduction: sexes are on the bodies, which is what the pin used to suppress.
    expect(state.agents[FISHER]!.sex).toBe('m')
    expect(state.agents[FARMER]!.sex).toBe('f')
  })

  // The same argument as the row above. The two that do not fire here — a desire-path tile
  // wearing through and a fauna kill — need a walker with a route and a hunter with a knife.
  it('C11 is live in this run: bodies thirst, wear out, are poisoned, and are buried', () => {
    const { state, evs } = G2
    const types = evs.map((e) => e.type)
    const dead = evs
      .filter((e) => e.type === 'agent_died')
      .map((e) => [(e.payload as Payload).agentId, (e.payload as Payload).cause])

    // Two bodies, two ways out, each cause one the world names. The farmer used to be the third,
    // of fatigue: his falls still put him on the ladder, and every night he sleeps takes him off it.
    expect(dead).toEqual([
      [IDLER, 'hunger'],
      [FISHER, 'poison'],
    ])
    for (const [, cause] of dead) expect(DEATH_CAUSES).toContain(cause)
    // A grave at the tile each of them fell on.
    const graves = Object.values(state.structures).filter((s) => s.kind === 'grave')
    expect(graves).toHaveLength(2)
    expect(evs.filter((e) => e.type === 'grave_placed')).toHaveLength(2)

    // The fatigue ladder and the poison that killed the Fisher are afflictions, not booleans.
    expect(
      evs.some((e) => e.type === 'agent_afflicted' && (e.payload as Payload).kind === 'poison'),
    ).toBe(true)
    // The ladder is still minted by a fall — three times here — and lifted every time a body
    // sleeps: the named proof that the rule fires, not merely that the death stopped happening.
    const fatigue = (type: string): number =>
      evs.filter((e) => e.type === type && (e.payload as Payload).kind === 'fatigue').length
    expect(fatigue('agent_afflicted')).toBe(3)
    expect(fatigue('affliction_recovered')).toBe(3)
    expect(evs.filter((e) => e.type === 'agent_collapsed')).toHaveLength(3)

    // Thirst: a second clock runs on every body, every tick, and the Builder is drier than he began.
    expect(types).toContain('thirst_changed')
    expect(state.agents[BUILDER]!.thirst).toBeLessThan(100)

    // Fauna: deer and fish are entities on the map now, and they move on their own.
    expect(types).toContain('fauna_spawned')
    expect(types).toContain('fauna_moved')
    expect(Object.keys(state.fauna ?? {}).length).toBeGreaterThan(0)

    // Regrowth seeds the felled forest edge; desire paths sweep the traffic table nightly.
    expect(
      evs.some((e) => e.type === 'tile_changed' && (e.payload as Payload).reason === 'seeded'),
    ).toBe(true)
    expect(types).toContain('traffic_decayed')

    // Warmth and light are live and inert by arithmetic here: a spring meadow is inside the
    // comfort band and nobody works at night. The fatigue death and the night theft are the proof.
    expect(G2_CONFIG.warmth.enabled).toBe(true)
    expect(G2_CONFIG.light.enabled).toBe(true)
  })

  it('is deterministic: two runs from the same seed hash identically', () => {
    const b = runScenario()
    expect(stateHash(G2.state)).toBe(stateHash(b.state))
  })

  it('replayFromGenesis equals the live run, config threaded explicitly', () => {
    const { state, store } = G2
    expect(stateHash(replayFromGenesis(store, G2_CONFIG, makeFixtureMap()))).toBe(stateHash(state))
  })

  // Two takings of the same knife off the same shelf by the same pair of hands, watched from the
  // same six tiles — the only difference between them is the light.
  it('the same theft is invisible at night and plain at noon (§19)', () => {
    // Folded from the shared log, not re-simulated: replayFromGenesis above pins that the fold
    // lands on the live state.
    const seen = (tick: number) => {
      const upTo = G2.evs.filter((e) => e.tick <= tick)
      const taken = upTo.filter((e) => e.type === 'item_taken')
      const state = upTo.reduce(
        (s, e) => fold(s, e, G2_CONFIG),
        genesisState(G2_CONFIG, makeFixtureMap()),
      )
      return { taken, watched: composePerception(state, G2_CONFIG, KEEPER, taken.slice(-1)).seen }
    }

    const night = seen(NIGHT_THEFT_TICK + 1)
    expect(night.taken).toHaveLength(1)
    expect(night.taken[0]!.payload).toMatchObject({
      itemId: STOLEN_ITEM,
      takerId: THIEF,
      ownerId: KEEPER,
    })
    expect(dayPhaseFromTick(night.taken[0]!.tick)).toBe('night')
    expect(night.watched).toEqual([])

    const noon = seen(NOON_THEFT_TICK + 1)
    expect(noon.taken).toHaveLength(2)
    expect(dayPhaseFromTick(noon.taken[1]!.tick)).toBe('day')
    expect(noon.watched).toContainEqual({
      kind: 'item_taken',
      takerName: 'Thief',
      ownerName: 'Keeper',
      itemKind: 'knife',
    })
  })

  it('crash at tick 2000: recover, continue to 4320, hash equals uninterrupted run', () => {
    const ref = G2

    const dir = mkdtempSync(join(tmpdir(), 'sj-g2-'))
    const dbPath = join(dir, 'town.db')
    try {
      const store = new EventStore(openDb(dbPath))
      const loop1 = createScriptedLoop(G2_CONFIG, SEED, store)
      runTicks(loop1, 2000)

      // "crash": no clean shutdown; recover from the durable store.
      const rec = replayLatest(store, G2_CONFIG, makeFixtureMap())
      const loop2: TickLoop = new TickLoop({
        store,
        state: rec.state,
        rng: rec.rng,
        config: G2_CONFIG,
        startTick: rec.state.tick,
        snapshotEveryTicks: 120,
        onTick: makeScriptedOnTick(G2_CONFIG, rec.rng, () => loop2.state),
      })
      runTicks(loop2, TOTAL_TICKS - rec.state.tick)
      expect(stateHash(loop2.state)).toBe(stateHash(ref.state))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
