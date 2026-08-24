// @slow — GATE G2, ~4320 ticks (documentary marker per plan; no vitest tag support, runs in CI)
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dayPhaseFromTick, SimConfigSchema, stateHash, type SimEvent } from '@sj/shared'
import type { WorldState } from './state.js'
import { openDb } from './db.js'
import { EventStore } from './eventStore.js'
import { TickLoop } from './tickLoop.js'
import { replayFromGenesis, replayLatest } from './replay.js'
import {
  createScriptedLoop, makeScriptedOnTick, makeFixtureMap,
  BUILDER, FARMER, FISHER, IDLER, STOREHOUSE, SHED,
  KEEPER, THIEF, STOLEN_ITEM, NIGHT_THEFT_TICK, NOON_THEFT_TICK,
} from './scripted.js'
import { composePerception } from './perception.js'
import { DEATH_CAUSES } from './systems/mortality.js'
import { nutritionOf } from './verbs.js'
// Pinned golden hash for the 3-day scripted world run (regen #6, deliberate: C11 TASK 37b,
// the authorized gate-remediation regen — batch-11 controller ruling R-G, on the evidence
// that G11b correctly rejected the world this fixture was pinning). C11's SECOND AND FINAL
// regen; there is no third, and society work that needs config goes to C8's keystone.
//
// EXACTLY ONE of the batch's six changes moves this hash: R15, the fatigue ladder (step 2a).
// G2's own row reads "bodies … wear out", and the Farmer's death IS that wearing out — a
// ruling that makes exhaustion survivable makes that death not happen, so no formulation of
// R-C leaves the pin still. The other five were each measured against this fixture and moved
// nothing: the makeable vocabulary and the blank-answer retry never touch the world, the
// take-then-eat seam changes no scripted act, and the two dials (garment insulation, injury
// drain) are inert on three spring days in which nobody owns a coat or is wounded.
// The attribution table, change by change, is in docs/superpowers/reports/g2-regen-c11-37b.md.
// Previous value (C11 Task 37): 665a824948155304d7dcc1131e821e89299dd73d6cb5c976287955edc5a5fa11
//
// Moved again by the `hut` → `house` rename lane, and by nothing else in it: the fixture
// builds one dwelling, the kind string is part of the structure the state hash covers, so
// renaming the kind moves this literal and no world law with it. G1 and BLOCK1 were measured
// against the same rename and did not move.
// Previous value (C11 Task 37b): c1c51b42aa340f0e5ae0d8cc321b602345f6ec4fee4e4d20b48f7e692b946d9c
//
// Moved again by the build-ledger cap, and by 23 events: the Builder starts her house at tick 21,
// which is night, so `workPenalty` gave her a 4 320-tick clock for a 2 880-tick house and the
// walls booked every extra tick she spent fumbling. `progressTicks` read 2 903 for a house that
// is 2 880. The ledger now stops at the work the building is; the dark still costs her the time.
// Previous value (the 2 903-tick house): 00d724345c37104d6c93f10398b96eded080b58db78108746e2a037fce836a10
const GOLDEN_G2_HASH = 'ec75f7f7e0948cb4cd6985d8d660ec93081ecc51ca4a0e733f25b9527c6b1bde'

// Task 16 Step 0 took C9's four pins off. Task 37 took C11's fourteen off in one act: this
// world has nothing suppressed in it at all. Every C11 law — mortality, thirst, fauna,
// warmth, light, the night witness, regrowth, desire paths — is live on the 3-day run, and
// the tests below name the ones that fire as well as hashing the state they leave behind.
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
  it('survival, rescue, death, build, fire, and crops all land in 3 sim days', () => {
    const { state, evs } = runScenario()

    // 1. Neither the Farmer nor the Fisher ever runs the hunger clock down — C9's line, and
    // still true. What takes them is C11: see the death table below.
    expect(state.agents[FARMER]!.zeroHungerSinceTick).toBeNull()
    expect(state.agents[FISHER]!.zeroHungerSinceTick).toBeNull()
    expect(state.agents[FARMER]!.needs.hunger).toBeGreaterThan(0)
    expect(state.agents[FISHER]!.needs.hunger).toBeGreaterThan(0)

    // 2. Idler collapses before death, and still dies of hunger — but not of C9's clock.
    // Task 37 unpinned mortality, and `hungerHpDrainPerTick` empties an empty body's hp bar
    // long before `deathAfterZeroHungerTicks` runs out, so the death lands early and the
    // attribution names the same thing the old timer would have.
    const collapseEv = evs.find((e) => e.type === 'agent_collapsed' && (e.payload as Payload).agentId === IDLER)
    expect(collapseEv).toBeDefined()
    const diedEv = evs.find((e) => e.type === 'agent_died' && (e.payload as Payload).agentId === IDLER)
    expect(diedEv).toBeDefined()
    expect((diedEv!.payload as Payload).cause).toBe('hunger')
    expect(collapseEv!.tick).toBeLessThan(diedEv!.tick)
    const zeroTick = state.agents[IDLER]!.zeroHungerSinceTick
    expect(zeroTick).not.toBeNull()
    expect(state.agents[IDLER]!.hp).toBeLessThanOrEqual(G2_CONFIG.health.deathHp)
    expect(diedEv!.tick).toBeLessThan(zeroTick! + G2_CONFIG.needs.deathAfterZeroHungerTicks + 1)

    // 3. Builder's house completes.
    const house = Object.values(state.structures).find((s) => s.kind === 'house')
    expect(house?.stage).toBe('complete')

    // 4. Day-2 fire: ignited, spreads to the adjacent shed, doused by rain; count unchanged.
    expect(evs.some((e) => e.type === 'fire_ignited' && (e.payload as Payload).structureId === STOREHOUSE.id)).toBe(true)
    expect(evs.some((e) => e.type === 'fire_spread'
      && (e.payload as Payload).fromId === STOREHOUSE.id && (e.payload as Payload).toId === SHED.id)).toBe(true)
    expect(evs.some((e) => e.type === 'fire_extinguished'
      && (e.payload as Payload).structureId === STOREHOUSE.id && (e.payload as Payload).cause === 'rain')).toBe(true)
    expect(evs.some((e) => e.type === 'fire_extinguished'
      && (e.payload as Payload).structureId === SHED.id && (e.payload as Payload).cause === 'rain')).toBe(true)
    // Three buildings and one stone for each of the two dead: graves are structures too.
    // Was six. Task 37b's fatigue ladder is why the third stone is not cut — see the death
    // table in the C11 row below.
    expect(Object.keys(state.structures)).toHaveLength(5)

    // 5. Wheat planted day 1: stage 0 after 2 dawns (floor(2×3/8)), not mature (growthDays 8), not withered.
    const wheat = Object.values(state.crops).find((c) => c.kind === 'wheat')
    expect(wheat).toBeDefined()
    expect(wheat!.stage).toBe(0)
    expect(wheat!.withered).toBe(false)
    expect(wheat!.stage).not.toBe(G2_CONFIG.crops.wheat!.stages - 1)

    // Rescue flow: collapsed Idler fed via give + eat (eat exempt), recovers, then dies.
    // Task 27 unpinned here priced the meal by kind: a fish is worth less than the flat
    // `eatRestoreHunger` it used to be, and `nutritionOf` is the one place that says so.
    const giveEv = evs.find((e) => e.type === 'item_moved'
      && (e.payload as Payload).loc !== undefined
      && ((e.payload as Payload).loc as Payload).t === 'agent'
      && ((e.payload as Payload).loc as Payload).id === IDLER)
    expect(giveEv).toBeDefined()
    expect(collapseEv!.tick).toBeLessThan(giveEv!.tick)
    // First meal of the run, so the variety bonus is nothing: the flat restore times the
    // fish's own worth, and no longer the flat restore.
    const firstFish = G2_CONFIG.needs.eatRestoreHunger * nutritionOf(G2_CONFIG, 'fish')
    expect(firstFish).toBeLessThan(G2_CONFIG.needs.eatRestoreHunger)
    const eatEv = evs.find((e) => e.type === 'need_changed'
      && (e.payload as Payload).id === IDLER
      && (e.payload as Payload).need === 'hunger'
      && (e.payload as Payload).delta === firstFish)
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

  // Task 16 removed the four pins that used to hold these laws off this fixture. If a
  // later change quietly stops one of them firing, the hash row above would still pass —
  // so each law is named here as well as hashed.
  it('C9 is live in this run: things are owned, a body sleeps under a roof, food turns', () => {
    const { state, evs } = runScenario()

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
    const slept = evs.find((e) => e.type === 'agent_slept' && (e.payload as Payload).agentId === BUILDER)
    expect(slept).toBeDefined()
    expect(inside.tick).toBeLessThan(slept!.tick)
    expect((inside.payload as Payload).structureId).toBe(house.id)
    expect(state.agents[BUILDER]!.insideId).toBe(house.id)

    // Spoilage: a two-day fish does not survive a three-day run.
    const spoiled = evs.filter((e) => e.type === 'item_spoiled')
    expect(spoiled.length).toBeGreaterThan(0)
    for (const e of spoiled) expect(state.items[(e.payload as Payload).id as string]).toBeUndefined()

    // Reproduction: sexes are on the bodies, which is what the pin used to suppress.
    expect(state.agents[FISHER]!.sex).toBe('m')
    expect(state.agents[FARMER]!.sex).toBe('f')
  })

  // Task 37(c). The same argument as the C9 row above, for the fourteen pins that came off
  // here: the hash would still pass if a law quietly stopped firing, so each one that fires
  // on this fixture is named. The two that do not — a desire-path tile wearing through and a
  // fauna kill — need a walker with a route and a hunter with a knife, and belong to G11a.
  it('C11 is live in this run: bodies thirst, wear out, are poisoned, and are buried', () => {
    const { state, evs } = runScenario()
    const types = evs.map((e) => e.type)
    const dead = evs.filter((e) => e.type === 'agent_died')
      .map((e) => [(e.payload as Payload).agentId, (e.payload as Payload).cause])

    // Mortality: two bodies, two different ways out, and each cause is one the world names.
    // THE FARMER USED TO BE THE THIRD, of fatigue. Task 37b's R15 is why he is not: his falls
    // still put him on the ladder, and now each night he sleeps takes him back off it. The
    // ladder is not switched off — it is answerable, which is the whole of ruling R-C.
    expect(dead).toEqual([[IDLER, 'hunger'], [FISHER, 'poison']])
    for (const [, cause] of dead) expect(DEATH_CAUSES).toContain(cause)
    // A grave at the tile each of them fell on.
    const graves = Object.values(state.structures).filter((s) => s.kind === 'grave')
    expect(graves).toHaveLength(2)
    expect(evs.filter((e) => e.type === 'grave_placed')).toHaveLength(2)

    // The fatigue ladder and the poison that killed the Fisher are afflictions, not booleans.
    expect(evs.some((e) => e.type === 'agent_afflicted' && (e.payload as Payload).kind === 'poison')).toBe(true)
    // The ladder is still minted by a fall — three times here — and it is lifted every time a
    // body sleeps, which is the named proof that R15 fires on this fixture and not merely that
    // the death stopped happening.
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
    expect(evs.some((e) => e.type === 'tile_changed' && (e.payload as Payload).reason === 'seeded')).toBe(true)
    expect(types).toContain('traffic_decayed')

    // Warmth and light are live and inert-by-arithmetic here: a spring meadow is inside the
    // comfort band, and nobody in this fixture works at night. The proof they are on is that
    // the two laws above them — the fatigue death and the night theft — both landed.
    expect(G2_CONFIG.warmth.enabled).toBe(true)
    expect(G2_CONFIG.light.enabled).toBe(true)
  })

  it('is deterministic: two runs from the same seed hash identically', () => {
    const a = runScenario()
    const b = runScenario()
    expect(stateHash(a.state)).toBe(stateHash(b.state))
  })

  it('replayFromGenesis equals the live run, config threaded explicitly', () => {
    const { state, store } = runScenario()
    expect(stateHash(replayFromGenesis(store, G2_CONFIG, makeFixtureMap()))).toBe(stateHash(state))
  })

  // Task 37(b). The C8 delta's missing fixture: `item_taken` had no scripted witness in the
  // golden world. Two takings of the same knife off the same shelf by the same pair of hands,
  // watched from the same six tiles — the only difference between them is the light.
  it('the same theft is invisible at night and plain at noon (§19)', () => {
    const seen = (tick: number) => {
      const store = new EventStore(openDb(':memory:'))
      const loop = createScriptedLoop(G2_CONFIG, SEED, store)
      runTicks(loop, tick)
      const taken = allEvents(store).filter((e) => e.type === 'item_taken')
      const last = taken.slice(-1)
      return { taken, watched: composePerception(loop.state, G2_CONFIG, KEEPER, last).seen }
    }

    const night = seen(NIGHT_THEFT_TICK + 1)
    expect(night.taken).toHaveLength(1)
    expect(night.taken[0]!.payload).toMatchObject({ itemId: STOLEN_ITEM, takerId: THIEF, ownerId: KEEPER })
    expect(dayPhaseFromTick(night.taken[0]!.tick)).toBe('night')
    expect(night.watched).toEqual([])

    const noon = seen(NOON_THEFT_TICK + 1)
    expect(noon.taken).toHaveLength(2)
    expect(dayPhaseFromTick(noon.taken[1]!.tick)).toBe('day')
    expect(noon.watched).toContainEqual({ kind: 'item_taken', takerName: 'Thief', ownerName: 'Keeper', itemKind: 'knife' })
  })

  it('crash at tick 2000: recover, continue to 4320, hash equals uninterrupted run', () => {
    const ref = runScenario()

    const dir = mkdtempSync(join(tmpdir(), 'sj-g2-'))
    const dbPath = join(dir, 'town.db')
    try {
      const store = new EventStore(openDb(dbPath))
      const loop1 = createScriptedLoop(G2_CONFIG, SEED, store)
      runTicks(loop1, 2000)

      // "crash": no clean shutdown; recover from the durable store.
      const rec = replayLatest(store, G2_CONFIG, makeFixtureMap())
      const loop2: TickLoop = new TickLoop({
        store, state: rec.state, rng: rec.rng, config: G2_CONFIG, startTick: rec.state.tick,
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
