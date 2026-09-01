import { describe, expect, it } from 'vitest'
import {
  RngStreams,
  awakeEnergyDecay,
  doorTile,
  findPath,
  fold,
  genesisState,
  makeFixtureMap,
} from '@sj/engine'
import type { WorldState } from '@sj/engine'
import { FOUNDER_IDS, INTERIOR_KINDS } from '@sj/shared'
import { libraryEntry } from '@sj/forge'
import { SHOWCASE_CONFIG } from './devWorld.js'
import { devTown } from './devTown.js'
import { showcaseTerrain } from './showcaseMap.js'
import {
  DEV_FAST_FORWARD_FOR_INTERIORS,
  FOUNDERS,
  FOUNDERS_HOME_ID,
  GO_HOME_BELOW,
  LEAVE_HOME_ABOVE,
  type FounderDef,
  MASON_KIND,
  MASON_WOOD_KIND,
  arrivesStanding,
  devHoldings,
  foundersFor,
  homeIntent,
  homeOf,
  makeFoundersOnTick,
  townStructuresFor,
  walkEnergyCost,
} from './founders.js'

function townAtTick1(): WorldState {
  let state = genesisState(SHOWCASE_CONFIG, makeFixtureMap())
  const events: { type: string; payload: unknown }[] = []
  const onTick = makeFoundersOnTick(SHOWCASE_CONFIG, new RngStreams('founders-test'), () => state)
  onTick({ tick: 1, emit: (type, payload) => events.push({ type, payload }) })
  let seq = 0
  for (const e of events) state = fold(state, { seq: ++seq, tick: 1, ...e }, SHOWCASE_CONFIG)
  return state
}

const spend = (state: WorldState, id: string, energy: number): WorldState => ({
  ...state,
  agents: {
    ...state.agents,
    [id]: { ...state.agents[id]!, needs: { ...state.agents[id]!.needs, energy } },
  },
})

const putAt = (state: WorldState, id: string, x: number, y: number): WorldState => ({
  ...state,
  agents: { ...state.agents, [id]: { ...state.agents[id]!, x, y } },
})

const putInside = (state: WorldState, id: string, structureId: string): WorldState => ({
  ...state,
  agents: { ...state.agents, [id]: { ...state.agents[id]!, insideId: structureId } },
})

describe('homeIntent', () => {
  const base = townAtTick1()
  const door = doorTile(base, base.structures[FOUNDERS_HOME_ID]!)!

  it('leaves a rested founder to the patrol', () => {
    expect(homeIntent(spend(base, 'omar', 90), SHOWCASE_CONFIG, 'omar')).toBeNull()
  })

  // A body that cannot reach this door lies down where it is instead — a different property, so
  // this one is asked of a founder who can still get there.
  it('walks a spent founder to the door of the one dwelling', () => {
    const s = putAt(spend(base, 'omar', 20), 'omar', 6, 32)
    expect(homeIntent(s, SHOWCASE_CONFIG, 'omar')).toEqual({
      verb: 'walk',
      params: { x: door.x, y: door.y },
    })
  })

  it('goes in once the founder is standing at the door', () => {
    const s = putAt(spend(base, 'omar', 10), 'omar', door.x, door.y)
    expect(homeIntent(s, SHOWCASE_CONFIG, 'omar')).toEqual({
      verb: 'enter',
      params: { structureId: FOUNDERS_HOME_ID },
    })
  })

  it('sleeps indoors, then comes out again once rested', () => {
    const inside = putInside(base, 'omar', FOUNDERS_HOME_ID)
    expect(homeIntent(spend(inside, 'omar', 10), SHOWCASE_CONFIG, 'omar')).toEqual({
      verb: 'sleep',
      params: {},
    })
    expect(
      homeIntent(spend(inside, 'omar', LEAVE_HOME_ABOVE + 1), SHOWCASE_CONFIG, 'omar'),
    ).toEqual({ verb: 'exit', params: {} })
  })

  it('says nothing about someone who is not there', () => {
    expect(homeIntent(base, SHOWCASE_CONFIG, 'nobody')).toBeNull()
  })
})

// `GO_HOME_BELOW` says how tired you must be to want your own bed, never how EARLY you have to
// leave to reach it. Both halves are asserted on the same body, separated only by distance.
describe('a founder leaves for home while the legs can still pay for the walk', () => {
  const base = townAtTick1()
  const door = doorTile(base, base.structures[FOUNDERS_HOME_ID]!)!
  const at = (x: number, y: number, energy: number): WorldState =>
    putAt(spend(base, 'omar', energy), 'omar', x, y)

  it('costs a walk out of the world’s own numbers — path ÷ tiles-per-tick × decay', () => {
    const s = at(door.x + 10, door.y, 50)
    const cost = walkEnergyCost(s, SHOWCASE_CONFIG, 'omar', door)!
    const path = findPath(s, s.agents.omar!, door, SHOWCASE_CONFIG)!
    const tired = Math.min(
      SHOWCASE_CONFIG.movement.baseTilesPerTick,
      SHOWCASE_CONFIG.movement.debuffTilesPerTick,
    )
    expect(cost).toBeCloseTo(
      Math.ceil(path.length / tired) * SHOWCASE_CONFIG.needs.energyDecayAwakePerTick,
      10,
    )
    // Priced at the TIRED rate: quoting today's speed under-prices the long late journeys.
    expect(tired).toBeLessThan(SHOWCASE_CONFIG.movement.baseTilesPerTick)
    expect(walkEnergyCost(at(door.x, door.y, 50), SHOWCASE_CONFIG, 'omar', door)).toBe(0)
  })

  it('★ turns for home EARLY when home is far, and not yet when home is under its nose', () => {
    // One energy short of the threshold at the door, so `GO_HOME_BELOW` ALONE says "carry on"
    // in both halves and only the journey can tell them apart.
    const energy = GO_HOME_BELOW + 1
    expect(homeIntent(at(door.x, door.y, energy), SHOWCASE_CONFIG, 'omar')).toBeNull()
    // The same body, the same energy, thirty tiles out: the walk has already eaten the margin.
    const far = at(6, 32, energy)
    expect(walkEnergyCost(far, SHOWCASE_CONFIG, 'omar', door)!).toBeGreaterThan(1)
    expect(homeIntent(far, SHOWCASE_CONFIG, 'omar')).toEqual({
      verb: 'walk',
      params: { x: door.x, y: door.y },
    })
  })

  it('★ AND LIES DOWN WHERE IT IS when the walk home is no longer affordable at all', () => {
    // `submitIntent` refuses every verb but eat and sleep to a collapsed body, so a WALK here
    // would leave it on the ground for ever.
    const stranded = at(6, 32, SHOWCASE_CONFIG.needs.collapseThreshold + 1)
    expect(arrivesStanding(stranded, SHOWCASE_CONFIG, 'omar', door)).toBe(false)
    expect(homeIntent(stranded, SHOWCASE_CONFIG, 'omar')).toEqual({ verb: 'sleep', params: {} })
  })

  it('★ prices the two ticks at the door, so the walk never ends in a collapse on the step', () => {
    // Enough for the walk and nothing more: enter and sleep would take the body under the threshold.
    const far = at(6, 32, GO_HOME_BELOW - 1)
    const decay = awakeEnergyDecay(SHOWCASE_CONFIG, far.agents.omar!)
    const need = walkEnergyCost(far, SHOWCASE_CONFIG, 'omar', door)! + 2 * decay
    const floor = SHOWCASE_CONFIG.needs.collapseThreshold
    const oneTickShort = at(6, 32, floor + need - decay)
    expect(arrivesStanding(oneTickShort, SHOWCASE_CONFIG, 'omar', door)).toBe(true)
    expect(homeIntent(oneTickShort, SHOWCASE_CONFIG, 'omar')).toEqual({ verb: 'sleep', params: {} })
    const oneTickSpare = at(6, 32, floor + need + decay)
    expect(homeIntent(oneTickSpare, SHOWCASE_CONFIG, 'omar')).toEqual({
      verb: 'walk',
      params: { x: door.x, y: door.y },
    })
  })

  it('★ and a body with NO path home lies down too, rather than answering nothing', () => {
    // Walled in by the river on every side: the door is still a door, there is simply no way
    // to it. `walkEnergyCost` says null and the body must still be given an answer.
    const moat = (s: WorldState, x: number, y: number): WorldState => ({
      ...s,
      terrain: s.terrain.map((row, ty) =>
        row.map((t, tx) =>
          Math.abs(tx - x) <= 1 && Math.abs(ty - y) <= 1 && !(tx === x && ty === y) ? 2 : t,
        ),
      ),
    })
    const s = moat(putAt(spend(base, 'omar', 10), 'omar', 6, 32), 6, 32)
    expect(walkEnergyCost(s, SHOWCASE_CONFIG, 'omar', door)).toBeNull()
    expect(homeIntent(s, SHOWCASE_CONFIG, 'omar')).toEqual({ verb: 'sleep', params: {} })
  })
})

describe('makeFoundersOnTick interiors switch', () => {
  const spent = (): WorldState => {
    const base = townAtTick1()
    const door = doorTile(base, base.structures[FOUNDERS_HOME_ID]!)!
    let s = base
    for (const id of Object.keys(base.agents)) s = spend(s, id, 5)
    return putAt(s, 'omar', door.x, door.y)
  }

  // `enter` is a timed verb: agent_entered lands when the action completes, not when it starts.
  const verbsStarted = (interiors: boolean): string[] => {
    const state = spent()
    const out: string[] = []
    const onTick = makeFoundersOnTick(
      SHOWCASE_CONFIG,
      new RngStreams('founders-test'),
      () => state,
      { interiors },
    )
    onTick({
      tick: 2,
      emit: (type, payload) => {
        if (type !== 'action_started') return
        const p = payload as { agentId: string; verb: string }
        if (p.agentId === 'omar') out.push(p.verb)
      },
    })
    return out
  }

  it("is OFF by default — no gate's world folds an event it did not fold before", () => {
    expect(verbsStarted(false)).not.toContain('enter')
  })

  it('sends a spent founder through the door when it is on', () => {
    expect(verbsStarted(true)).toContain('enter')
  })

  // The patrol arm has no `homeIntent` behind it to catch a body that overreaches. Asked on the
  // FIXTURE waypoints, because the showcase's well-and-back leg is too short to bite.
  it('★ will not set out on a leg the legs cannot pay for — it lies down instead', () => {
    const HERE = { x: 5, y: 5 },
      YONDER = { x: 58, y: 60 } // opposite corners of the fixture
    const far = FOUNDERS.map((f) => ({ ...f, patrol: [HERE, YONDER] as FounderDef['patrol'] }))
    const started = (energy: number): string[] => {
      const state = putAt(spend(townAtTick1(), 'omar', energy), 'omar', HERE.x, HERE.y)
      const out: string[] = []
      makeFoundersOnTick(SHOWCASE_CONFIG, new RngStreams('leg'), () => state, { founders: far })({
        tick: 2,
        emit: (type, payload) => {
          const p = payload as { agentId: string; verb: string }
          if (type === 'action_started' && p.agentId === 'omar') out.push(p.verb)
        },
      })
      return out
    }
    // Rested, the same leg is simply a walk. At three tiles a tick the crossing costs a third of
    // what it did, so the energy it can no longer be paid for out of sits UNDER the patrol's own
    // sleep line — the gate is asked directly, because the policy can no longer be asked alone.
    expect(started(100)).toEqual(['walk'])
    const at = (energy: number): WorldState =>
      putAt(spend(townAtTick1(), 'omar', energy), 'omar', HERE.x, HERE.y)
    expect(arrivesStanding(at(24), SHOWCASE_CONFIG, 'omar', YONDER)).toBe(true)
    expect(arrivesStanding(at(10), SHOWCASE_CONFIG, 'omar', YONDER)).toBe(false)
    expect(started(10)).toEqual(['sleep'])
  })
})

const SHOWCASE_STRUCTURES = devTown().structures

function showcaseTownAtTick1(): WorldState {
  let state = genesisState(SHOWCASE_CONFIG, showcaseTerrain())
  const events: { type: string; payload: unknown }[] = []
  const onTick = makeFoundersOnTick(SHOWCASE_CONFIG, new RngStreams('u25'), () => state, {
    structures: SHOWCASE_STRUCTURES,
  })
  onTick({ tick: 1, emit: (type, payload) => events.push({ type, payload }) })
  let seq = 0
  for (const e of events) state = fold(state, { seq: ++seq, tick: 1, ...e }, SHOWCASE_CONFIG)
  return state
}

describe('homeOf', () => {
  const town = showcaseTownAtTick1()

  it('gives each of the five founders a different roof', () => {
    const homes = FOUNDER_IDS.map((id) => homeOf(town, id))
    for (const h of homes) expect(h).not.toBeNull()
    expect(new Set(homes.map((h) => h!.id)).size).toBe(5)
    expect(new Set(homes.map((h) => h!.kind))).toEqual(new Set(['house']))
  })

  it('says nothing about someone who owns nothing', () => {
    expect(homeOf(town, 'nobody')).toBeNull()
  })

  it('ignores a roof that is not built yet', () => {
    const id = homeOf(town, 'amara')!.id
    const half: WorldState = {
      ...town,
      structures: { ...town.structures, [id]: { ...town.structures[id]!, stage: 'construction' } },
    }
    expect(homeOf(half, 'amara')).toBeNull()
  })
})

describe('U25 — the humans were all sleeping inside one house', () => {
  // Every founder is kept spent so home is the only errand; the run ends when all five are indoors.
  it('puts five tired founders under five different roofs', () => {
    let state = showcaseTownAtTick1()
    const onTick = makeFoundersOnTick(SHOWCASE_CONFIG, new RngStreams('u25'), () => state, {
      interiors: true,
      structures: SHOWCASE_STRUCTURES,
    })
    let seq = 1000
    for (let tick = 2; tick <= 400; tick++) {
      // Tired enough that home is the only errand, rested enough that home is still reachable:
      // a body that cannot pay for the walk lies down instead, which is proved above.
      for (const id of FOUNDER_IDS) state = spend(state, id, GO_HOME_BELOW - 5)
      const evs: { type: string; payload: unknown }[] = []
      onTick({ tick, emit: (type, payload) => evs.push({ type, payload }) })
      for (const e of evs) state = fold(state, { seq: ++seq, tick, ...e }, SHOWCASE_CONFIG)
      if (FOUNDER_IDS.every((id) => state.agents[id]?.insideId !== undefined)) break
    }
    const inside = FOUNDER_IDS.map((id) => state.agents[id]!.insideId)
    expect(inside.filter((i) => i !== undefined)).toHaveLength(5)
    expect(new Set(inside).size).toBe(5)
  })
})

describe('homeIntent routes an owner to their own door', () => {
  const town = showcaseTownAtTick1()

  it('walks a spent owner to their OWN door, not to a shared one', () => {
    for (const id of FOUNDER_IDS) {
      const mine = homeOf(town, id)!
      const door = doorTile(town, mine)!
      const s = putAt(spend(town, id, 10), id, door.x + 4, door.y)
      expect(homeIntent(s, SHOWCASE_CONFIG, id)).toEqual({
        verb: 'walk',
        params: { x: door.x, y: door.y },
      })
    }
    const doors = FOUNDER_IDS.map((id) => doorTile(town, homeOf(town, id)!)!)
    expect(new Set(doors.map((d) => `${d.x},${d.y}`)).size).toBe(5)
  })

  it('enters their OWN house from one tile away', () => {
    for (const id of FOUNDER_IDS) {
      const mine = homeOf(town, id)!
      const door = doorTile(town, mine)!
      const s = putAt(spend(town, id, 10), id, door.x, door.y)
      expect(homeIntent(s, SHOWCASE_CONFIG, id)).toEqual({
        verb: 'enter',
        params: { structureId: mine.id },
      })
    }
  })

  it('leaves the unhoused scripted fixture exactly as it was', () => {
    const base = townAtTick1()
    const door = doorTile(base, base.structures[FOUNDERS_HOME_ID]!)!
    const s = putAt(spend(base, 'omar', 20), 'omar', 6, 32)
    expect(homeOf(base, 'omar')).toBeNull()
    expect(homeIntent(s, SHOWCASE_CONFIG, 'omar')).toEqual({
      verb: 'walk',
      params: { x: door.x, y: door.y },
    })
  })
})

describe('foundersFor', () => {
  const defs = foundersFor(SHOWCASE_STRUCTURES)
  const town = showcaseTownAtTick1()

  it('spawns every founder on their own doorstep', () => {
    expect(defs).toHaveLength(5)
    for (const d of defs) {
      const door = doorTile(town, homeOf(town, d.id)!)!
      expect(d.spawn).toEqual({ x: door.x, y: door.y })
    }
  })

  it('gives five distinct, walkable spawns', () => {
    const keys = defs.map((d) => `${d.spawn.x},${d.spawn.y}`)
    expect(new Set(keys).size).toBe(5)
    const terrain = showcaseTerrain()
    for (const d of defs) expect(terrain[d.spawn.y]![d.spawn.x]).not.toBe(2) // never in the river
  })
})

describe('the interiors demo window', () => {
  it('starts before the first measured trip indoors, not after it', () => {
    expect(DEV_FAST_FORWARD_FOR_INTERIORS).toBeLessThan(814)
    expect(DEV_FAST_FORWARD_FOR_INTERIORS).toBeGreaterThan(600) // not a whole day of waiting
  })

  it("keeps home ahead of the patrol policy's own outdoor sleep", () => {
    expect(GO_HOME_BELOW).toBeGreaterThan(20)
    expect(LEAVE_HOME_ABOVE).toBeGreaterThan(GO_HOME_BELOW)
  })
})

describe('the storerooms hold something', () => {
  /** the web card's cap — packages/web/src/ui/interiorModel.ts ROOM_HOLDS_MAX */
  const ROOM_HOLDS_MAX = 8

  function showcaseAtTick1(): WorldState {
    const structures = townStructuresFor('showcase')
    let state = genesisState(SHOWCASE_CONFIG, showcaseTerrain())
    const events: { type: string; payload: unknown }[] = []
    const onTick = makeFoundersOnTick(
      SHOWCASE_CONFIG,
      new RngStreams('holdings-test'),
      () => state,
      {
        structures,
        founders: foundersFor(structures),
        holdings: true,
      },
    )
    onTick({ tick: 1, emit: (type, payload) => events.push({ type, payload }) })
    let seq = 0
    for (const e of events) state = fold(state, { seq: ++seq, tick: 1, ...e }, SHOWCASE_CONFIG)
    return state
  }

  const held = (state: WorldState, structureId: string) =>
    Object.values(state.items).filter((i) => i.loc.t === 'structure' && i.loc.id === structureId)

  it('THE BEFORE-STATE: the town stored nothing at all, in any building', () => {
    expect(devHoldings([]).length).toBe(0)
    expect(
      Object.values(showcaseAtTick1().items).filter((i) => i.loc.t === 'structure').length,
    ).toBeGreaterThan(0)
  })

  it('fills the public storehouse past the card’s cap, so "and N more" is real', () => {
    const state = showcaseAtTick1()
    const store = Object.values(state.structures).find((s) => s.kind === 'storehouse')!
    expect(new Set(held(state, store.id).map((i) => i.kind)).size).toBeGreaterThan(ROOM_HOLDS_MAX)
  })

  it('puts something in every enterable room, so no room reads as empty by accident', () => {
    const state = showcaseAtTick1()
    for (const s of Object.values(state.structures)) {
      if (!(INTERIOR_KINDS as readonly string[]).includes(s.kind)) continue
      expect(held(state, s.id).length, s.id).toBeGreaterThan(0)
    }
  })

  it('marks a house’s things as its owner’s, and leaves the public store unowned', () => {
    const state = showcaseAtTick1()
    for (const s of Object.values(state.structures)) {
      for (const it of held(state, s.id)) expect(it.owner, `${s.id}/${it.kind}`).toBe(s.owner)
    }
  })

  it('every kind it seeds is one the library can draw an icon for', () => {
    for (const h of devHoldings(townStructuresFor('showcase'))) {
      // `wood` is the one kind the world consumes that the art library has not drawn under that
      // name — its planks are catalogued as `timber`. This rule yields to the recipe's.
      if (h.kind === MASON_WOOD_KIND) continue
      expect(libraryEntry(h.kind), h.kind).not.toBeNull()
    }
  })

  // No recipe in the world consumes `timber` — a house is `{ wood: 10 }` — so a mind could carry
  // fifteen of something wooden to a plot and be refused for having no wood.
  it('★ stocks the kind a house is actually built from, not a synonym for it', () => {
    const houseCost = SHOWCASE_CONFIG.structures.recipes[MASON_KIND]!.inputs[MASON_WOOD_KIND]!
    const stocked = devHoldings(townStructuresFor('showcase'))
      .filter((h) => h.kind === MASON_WOOD_KIND)
      .reduce((n, h) => n + h.qty, 0)
    expect(stocked, `the town holds no ${MASON_WOOD_KIND} at all`).toBeGreaterThan(0)
    expect(stocked, 'not even one house worth').toBeGreaterThanOrEqual(houseCost)
  })

  // `composePerception` shows a building's shelves only to a mind INSIDE it or against its wall,
  // and every founder spawns and enters at their own door — so the public store is never seen.
  it('★ puts the wood where a founder will actually see it — their own shelf', () => {
    const structures = townStructuresFor('showcase')
    const holdings = devHoldings(structures)
    const woodByStructure = new Set(
      holdings.filter((h) => h.kind === MASON_WOOD_KIND).map((h) => h.structureId),
    )
    for (const f of FOUNDERS) {
      const home = structures.find((s) => s.owner === f.id)
      expect(home, `${f.id} owns no roof`).toBeDefined()
      expect(woodByStructure.has(home!.id), `${f.id}'s own home holds no ${MASON_WOOD_KIND}`).toBe(
        true,
      )
    }
  })

  it('holds nothing whose kind no recipe and no verb can use', () => {
    const consumable = new Set<string>()
    for (const r of Object.values(SHOWCASE_CONFIG.structures.recipes)) {
      for (const k of Object.keys(r.inputs)) consumable.add(k)
    }
    for (const r of Object.values(SHOWCASE_CONFIG.crafting.recipes)) {
      for (const k of Object.keys(r.inputs)) consumable.add(k)
    }
    // A shelf may hold food, tools and cloth that no RECIPE eats — those have their own verbs.
    // What it may not hold is a building material under a name no recipe has heard of.
    expect(consumable.has('timber'), 'no recipe consumes `timber`').toBe(false)
    const kinds = new Set(devHoldings(townStructuresFor('showcase')).map((h) => h.kind))
    expect(kinds.has('timber'), 'the town stocks a material nothing can build with').toBe(false)
  })

  it('is deterministic, and its ids can never collide with a minted one', () => {
    const a = devHoldings(townStructuresFor('showcase'))
    const b = devHoldings(townStructuresFor('showcase'))
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
    expect(new Set(a.map((h) => h.id)).size).toBe(a.length)
    // mintId hands out `<prefix>_<n>` and fold bumps the counter off a trailing number, so an
    // id ending in a digit would move the world's entity counter. A fixture must never do that.
    for (const h of a) expect(h.id, h.id).not.toMatch(/_\d+$/)
  })

  // The seed is OFF unless asked for: the scripted fixture is frozen and this is a demo larder.
  it('leaves the frozen scripted fixture exactly as every landed gate folded it', () => {
    expect(Object.keys(townAtTick1().items)).toEqual([])
  })
})
